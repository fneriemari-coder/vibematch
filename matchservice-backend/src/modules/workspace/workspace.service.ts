import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  Currency,
  EscrowStatus,
  GrowthPillar,
  Role,
  WorkspaceAnalysis,
  WorkspaceAnalysisStatus,
  WorkspaceDocKind,
  WorkspaceDocument,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { LazyOpenAI } from '../../common/ai/lazy-openai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3StorageService } from '../../common/storage/s3-storage.service';
import { MARKET_SKILL_TAGS } from '../diagnostics/growth-analyzer';
import { AnalysisFinding, AnalyzedDocument, FindingSeverity, analyzeDocument } from './document-analyzer';
import { classifyDocument } from './document-classifier';
import { extractText } from './document-extractor';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

/**
 * Hard ceiling on what we keep of a document's text. 60k characters is roughly
 * a 25-page contract — beyond that the marginal clause adds nothing the
 * analyser will reach, and a single row that can grow without bound is a
 * problem waiting for the first 200-page PDF.
 *
 * `charCount` on the row records the length BEFORE this cut, which is what
 * lets the client say what was left out instead of quietly analysing a
 * fraction of the file.
 */
const MAX_STORED_CHARS = 60_000;

/** How much of the document goes into a single model call. */
const MAX_MODEL_CHARS = 14_000;

const MAX_MATCHED_PROVIDERS = 4;

const ANALYSIS_SCHEMA = {
  name: 'document_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      headline: { type: 'string' },
      summary: { type: 'string' },
      findings: {
        type: 'array',
        minItems: 2,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            severity: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAIXA'] },
          },
          required: ['title', 'detail', 'severity'],
          additionalProperties: false,
        },
      },
      risks: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
      actions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      suggestedSkills: {
        type: 'array',
        items: { type: 'string', enum: [...MARKET_SKILL_TAGS] },
        minItems: 1,
        maxItems: 5,
      },
    },
    required: ['headline', 'summary', 'findings', 'risks', 'actions', 'suggestedSkills'],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT =
  'Você é o analista de documentos da VIBE MATCH, uma plataforma brasileira onde donos de empresa sobem um arquivo ' +
  '(contrato, proposta, relatório financeiro, export de planilha) e perguntam o que querem saber sobre ele.\n\n' +
  'Regras obrigatórias:\n' +
  '1. Responda PRIMEIRO a pergunta do usuário. Se o documento não trata daquilo, diga isso explicitamente e diga ' +
  'quais termos você procurou. Nunca troque a pergunta por outra que você saiba responder.\n' +
  '2. Toda constatação precisa apontar para o documento: cite entre aspas o trecho literal em que ela se apoia, ou ' +
  'afirme claramente que aquilo NÃO consta. Ausência de cláusula é a constatação mais valiosa que você pode ' +
  'produzir — reporte o que falta, não só o que está lá.\n' +
  '3. Severidade se ganha. ALTA só quando existe exposição concreta de dinheiro, prazo ou obrigação sem contrapartida.\n' +
  '4. Nada de conselho genérico de gestão. Se você não tem uma constatação sustentada pelo texto, produza menos ' +
  'constatações — nunca preencha espaço.\n' +
  '5. suggestedSkills são as competências de mercado que o usuário precisaria contratar para executar as ações ' +
  'recomendadas, escolhidas SOMENTE da lista permitida.\n' +
  '6. Escreva em português do Brasil, na segunda pessoa, direto e sem jargão jurídico desnecessário.\n\n' +
  'Uma análise determinística já foi produzida localmente e vai junto como referência: use-a para não perder ' +
  'nenhuma lacuna que ela detectou, e melhore a redação e o encadeamento. Não contradiga um fato dela sem ' +
  'apontar o trecho do documento que a desmente.';

/** One provider the analysis can be handed to. Resolved on read, never stored. */
export interface MatchedProvider {
  userId: string;
  name: string;
  headline: string;
  skills: string[];
  kScore: number;
  hourlyRate: number | null;
  rateCurrency: Currency;
}

/** The caller's own platform state — the half a generic chatbot cannot have. */
export interface AnalysisContext {
  kScore: number;
  openContracts: number;
  weakestPillar: GrowthPillar | null;
}

export interface AnalysisResponse {
  id: string;
  documentId: string;
  question: string;
  status: WorkspaceAnalysisStatus;
  headline: string;
  summary: string;
  findings: AnalysisFinding[];
  risks: string[];
  actions: string[];
  suggestedSkills: string[];
  matchedProviders: MatchedProvider[];
  context: AnalysisContext;
  aiGenerated: boolean;
  createdAt: Date;
}

export interface DocumentSummaryResponse {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: WorkspaceDocKind;
  charCount: number;
  storedCharCount: number;
  truncated: boolean;
  storageUrl: string | null;
  createdAt: Date;
  analysisCount: number;
}

export interface DocumentDetailResponse extends DocumentSummaryResponse {
  analyses: AnalysisResponse[];
}

export interface UploadResponse extends DocumentSummaryResponse {
  /** Plain-language note about what was read, shown once after the upload. */
  message: string;
}

/**
 * The AI analysis workspace.
 *
 * A business owner drops a file, says what they want from it, and gets back an
 * analysis of THAT file — plus the two things this platform has and a generic
 * chatbot does not: their own numbers (K-Score, open contracts, weakest growth
 * pillar) and real, named providers on this marketplace who carry the exact
 * skills the analysis says they need.
 *
 * Two paths write the same shape. The model path goes through `LazyOpenAI`
 * with a strict JSON schema, never a directly constructed OpenAI client. The
 * local path, `document-analyzer.ts`, is a real analyser and is what runs
 * whenever the key is missing or the call fails for any reason at all —
 * which, in the environment this gets demonstrated in, is always.
 */
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private readonly openai: LazyOpenAI;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: S3StorageService,
  ) {
    this.openai = new LazyOpenAI(
      this.config.get('OPENAI_API_KEY'),
      this.logger,
      'model-written document analysis (the local analyser covers it meanwhile)',
    );
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  /**
   * Stores an uploaded file's TEXT, not the file. If nothing readable came out
   * of it — a scanned PDF is the case this exists for — nothing is stored and
   * the caller gets 422 with the reason, because a document row that answers
   * questions about text nobody extracted is the worst failure this feature
   * has.
   */
  async createDocument(
    userId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<UploadResponse> {
    const filename = sanitizeFilename(file.originalname);
    const extraction = await extractText(file.buffer, file.mimetype, filename);

    if (!extraction.ok) {
      this.logger.warn(`Rejected ${filename} for user ${userId}: ${extraction.reason}`);
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: extraction.reason,
        message: extraction.message,
      });
    }

    const charCount = extraction.text.length;
    const extractedText = extraction.text.slice(0, MAX_STORED_CHARS);
    const kind = classifyDocument(filename, file.mimetype, extractedText);
    const storageUrl = await this.archive(userId, filename, file);

    const document = await this.prisma.workspaceDocument.create({
      data: {
        userId,
        filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        kind,
        extractedText,
        charCount,
        storageUrl,
      },
    });

    const truncated = charCount > extractedText.length;
    this.logger.log(
      `Document ${document.id} stored for user ${userId} — ${kind}, ${charCount} chars` +
        (truncated ? ` (truncated to ${extractedText.length})` : ''),
    );

    return {
      ...this.toDocumentSummary(document, 0),
      message: truncated
        ? `Li ${new Intl.NumberFormat('pt-BR').format(extractedText.length)} dos ` +
          `${new Intl.NumberFormat('pt-BR').format(charCount)} caracteres de “${filename}”. ` +
          'O restante foi cortado e não entra na análise.'
        : `Li “${filename}” inteiro: ${new Intl.NumberFormat('pt-BR').format(charCount)} caracteres, ` +
          `classificado como ${kind}. Agora diga o que você quer saber sobre ele.`,
    };
  }

  async listDocuments(userId: string): Promise<DocumentSummaryResponse[]> {
    const documents = await this.prisma.workspaceDocument.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { analyses: true } } },
    });
    return documents.map((document) => this.toDocumentSummary(document, document._count.analyses));
  }

  /**
   * Owner-only, and 403 rather than 404 so the rule is legible in the logs.
   * Same lesson the escrow and quiz-generation IDORs already taught this
   * codebase: never serve a row just because its id was guessed. An uploaded
   * contract is at least as sensitive as anything else here.
   */
  async findDocument(userId: string, id: string): Promise<DocumentDetailResponse> {
    const document = await this.prisma.workspaceDocument.findUnique({
      where: { id },
      include: {
        analyses: { orderBy: { createdAt: 'desc' } },
        _count: { select: { analyses: true } },
      },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');
    if (document.userId !== userId) {
      throw new ForbiddenException('Você só pode acessar os seus próprios documentos');
    }

    const context = await this.loadContext(userId);
    const skills = [...new Set(document.analyses.flatMap((analysis) => analysis.suggestedSkills))];
    // One query for every analysis on the page; `pickProviders` narrows each
    // analysis to its own skills afterwards. The pool is deliberately wider
    // than the per-analysis cap so narrowing never starves a row.
    const providers = await this.findProviders(userId, skills, MAX_MATCHED_PROVIDERS * 6);

    return {
      ...this.toDocumentSummary(document, document._count.analyses),
      analyses: document.analyses.map((analysis) =>
        this.toAnalysisResponse(analysis, pickProviders(providers, analysis.suggestedSkills), context),
      ),
    };
  }

  async deleteDocument(userId: string, id: string): Promise<{ deleted: true; id: string }> {
    const document = await this.prisma.workspaceDocument.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');
    if (document.userId !== userId) {
      throw new ForbiddenException('Você só pode apagar os seus próprios documentos');
    }

    // Analyses cascade off the document (see schema).
    await this.prisma.workspaceDocument.delete({ where: { id } });
    this.logger.log(`Document ${id} deleted by owner ${userId}`);
    return { deleted: true, id };
  }

  // -------------------------------------------------------------------------
  // Analyses
  // -------------------------------------------------------------------------

  async createAnalysis(userId: string, documentId: string, dto: CreateAnalysisDto): Promise<AnalysisResponse> {
    const document = await this.prisma.workspaceDocument.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException('Documento não encontrado');
    if (document.userId !== userId) {
      throw new ForbiddenException('Você só pode analisar os seus próprios documentos');
    }

    const question = dto.question.trim();
    const { analysis, aiGenerated, status } = await this.analyze(document, question);

    const stored = await this.prisma.workspaceAnalysis.create({
      data: {
        documentId: document.id,
        userId,
        question,
        status,
        headline: analysis.headline,
        summary: analysis.summary,
        findings: analysis.findings as unknown as object[],
        risks: analysis.risks,
        actions: analysis.actions,
        suggestedSkills: analysis.suggestedSkills,
        aiGenerated,
      },
    });

    const [context, providers] = await Promise.all([
      this.loadContext(userId),
      this.findProviders(userId, analysis.suggestedSkills),
    ]);

    this.logger.log(
      `Analysis ${stored.id} on document ${document.id} (${document.kind}) — ${analysis.findings.length} findings, ` +
        `${providers.length} matched providers, source ${aiGenerated ? 'model' : 'local analyser'}`,
    );

    return this.toAnalysisResponse(stored, providers, context);
  }

  /**
   * Model first, local analyser as the guaranteed floor.
   *
   * Every failure collapses to the same branch on purpose: no key, a 401 from
   * a stale one, a network this sandbox blocks, a rate limit, a malformed
   * completion. None of those are the user's problem and none of them justify
   * an analysis that says nothing.
   */
  private async analyze(
    document: WorkspaceDocument,
    question: string,
  ): Promise<{ analysis: AnalyzedDocument; aiGenerated: boolean; status: WorkspaceAnalysisStatus }> {
    const local = analyzeDocument({
      filename: document.filename,
      kind: document.kind,
      text: document.extractedText,
      question,
    });

    if (!this.openai.isConfigured) {
      this.logger.warn('OPENAI_API_KEY not configured — answering with the local document analyser');
      return { analysis: local, aiGenerated: false, status: statusFor(local) };
    }

    try {
      const analysis = await this.analyzeWithModel(document, question, local);
      return { analysis, aiGenerated: true, status: statusFor(analysis) };
    } catch (err) {
      this.logger.warn(
        `Document analysis model call failed (${(err as Error).message}) — falling back to the local analyser`,
      );
      return { analysis: local, aiGenerated: false, status: statusFor(local) };
    }
  }

  private async analyzeWithModel(
    document: WorkspaceDocument,
    question: string,
    local: AnalyzedDocument,
  ): Promise<AnalyzedDocument> {
    const excerpt = document.extractedText.slice(0, MAX_MODEL_CHARS);
    const userContent =
      `Tipo detectado: ${document.kind}\nArquivo: ${document.filename}\n\n` +
      `PERGUNTA DO USUÁRIO:\n${question}\n\n` +
      `DOCUMENTO (${excerpt.length} de ${document.charCount} caracteres):\n"""\n${excerpt}\n"""\n\n` +
      `ANÁLISE DETERMINÍSTICA JÁ PRODUZIDA (referência):\n${JSON.stringify(local, null, 2)}`;

    const completion = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: ANALYSIS_SCHEMA },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty completion from OpenAI while analysing a workspace document');

    return this.normalizeModelOutput(JSON.parse(raw) as AnalyzedDocument, local);
  }

  /**
   * Trusts the model for the writing, never for the invariants. Severity is
   * constrained to the three the client renders, skills are re-filtered
   * against the real vocabulary even though the schema already constrains
   * them, and a reply with no usable headline/summary/findings is treated as
   * a failure so the local analyser takes over rather than shipping a hollow
   * analysis with `aiGenerated: true` on it.
   */
  private normalizeModelOutput(parsed: AnalyzedDocument, local: AnalyzedDocument): AnalyzedDocument {
    const allowedSeverities: FindingSeverity[] = ['ALTA', 'MEDIA', 'BAIXA'];
    const findings = (parsed.findings ?? [])
      .filter((finding) => finding?.title?.trim() && finding?.detail?.trim())
      .map((finding) => ({
        title: finding.title.trim(),
        detail: finding.detail.trim(),
        severity: allowedSeverities.includes(finding.severity) ? finding.severity : 'BAIXA',
      }));

    const allowed = new Set<string>(MARKET_SKILL_TAGS);
    const suggestedSkills = [...new Set(parsed.suggestedSkills ?? [])].filter((skill) => allowed.has(skill));

    if (!parsed.headline?.trim() || !parsed.summary?.trim() || findings.length === 0) {
      throw new Error('Model returned an analysis with no usable headline, summary or findings');
    }

    return {
      headline: parsed.headline.trim(),
      summary: parsed.summary.trim(),
      findings,
      risks: (parsed.risks ?? []).map((risk) => risk.trim()).filter(Boolean),
      actions: (parsed.actions ?? []).map((action) => action.trim()).filter(Boolean),
      // Never let the model's skill list come back empty: an unmatched
      // analysis loses the only thing this workspace has that a chatbot does not.
      suggestedSkills: suggestedSkills.length ? suggestedSkills : local.suggestedSkills,
    };
  }

  // -------------------------------------------------------------------------
  // The platform half — the part a generic chatbot cannot produce
  // -------------------------------------------------------------------------

  /**
   * Real providers on this marketplace who carry the skills the analysis asks
   * for, ordered by K-Score.
   *
   * Resolved on read and never stored: a provider who leaves, changes their
   * skills or whose score moves must not be rendered from a months-old
   * snapshot. The caller is excluded — recommending someone to themselves is
   * a bug the user notices immediately.
   */
  private async findProviders(
    userId: string,
    skills: string[],
    limit = MAX_MATCHED_PROVIDERS,
  ): Promise<MatchedProvider[]> {
    if (skills.length === 0) return [];

    const profiles = await this.prisma.userProfile.findMany({
      where: {
        skills: { hasSome: skills },
        userId: { not: userId },
        user: {
          role: { in: [Role.PROVIDER, Role.BOTH] },
          deletedAt: null,
          accountStatus: AccountStatus.ACTIVE,
        },
      },
      select: {
        userId: true,
        name: true,
        bio: true,
        skills: true,
        hourlyRate: true,
        rateCurrency: true,
        mentorHeadline: true,
        user: { select: { score: { select: { financialHealthScore: true } } } },
      },
    });

    return profiles
      .map((profile) => ({
        userId: profile.userId,
        name: profile.name,
        headline: profile.mentorHeadline?.trim() || firstSentence(profile.bio),
        skills: profile.skills,
        kScore: profile.user.score?.financialHealthScore ?? 0,
        hourlyRate: profile.hourlyRate ? Number(profile.hourlyRate) : null,
        rateCurrency: profile.rateCurrency,
      }))
      .sort(
        (a, b) =>
          b.kScore - a.kScore ||
          overlap(b.skills, skills) - overlap(a.skills, skills) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit);
  }

  /** The caller's own numbers, read fresh on every response. */
  private async loadContext(userId: string): Promise<AnalysisContext> {
    const [score, openContracts, diagnostic] = await Promise.all([
      this.prisma.providerScore.findUnique({
        where: { providerId: userId },
        select: { financialHealthScore: true },
      }),
      this.prisma.escrowProject.count({
        where: {
          status: { not: EscrowStatus.COMPLETED },
          OR: [{ clientId: userId }, { providerId: userId }],
        },
      }),
      this.prisma.growthDiagnostic.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { weakestPillar: true },
      }),
    ]);

    return {
      kScore: score?.financialHealthScore ?? 0,
      openContracts,
      weakestPillar: diagnostic?.weakestPillar ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------

  private toDocumentSummary(
    document: WorkspaceDocument,
    analysisCount: number,
  ): DocumentSummaryResponse {
    return {
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      kind: document.kind,
      charCount: document.charCount,
      storedCharCount: document.extractedText.length,
      truncated: document.charCount > document.extractedText.length,
      storageUrl: document.storageUrl,
      createdAt: document.createdAt,
      analysisCount,
    };
  }

  private toAnalysisResponse(
    analysis: WorkspaceAnalysis,
    matchedProviders: MatchedProvider[],
    context: AnalysisContext,
  ): AnalysisResponse {
    return {
      id: analysis.id,
      documentId: analysis.documentId,
      question: analysis.question,
      status: analysis.status,
      headline: analysis.headline,
      summary: analysis.summary,
      findings: (analysis.findings ?? []) as unknown as AnalysisFinding[],
      risks: analysis.risks,
      actions: analysis.actions,
      suggestedSkills: analysis.suggestedSkills,
      matchedProviders,
      context,
      aiGenerated: analysis.aiGenerated,
      createdAt: analysis.createdAt,
    };
  }

  /**
   * Keeps the original bytes only when S3 is actually configured. When it is
   * not, `storageUrl` stays null rather than pointing at a file nobody can
   * download — and the upload still succeeds, because the extracted text is
   * what the analysis needs.
   */
  private async archive(
    userId: string,
    filename: string,
    file: { mimetype: string; buffer: Buffer },
  ): Promise<string | null> {
    try {
      const key = `workspace/${userId}/${randomUUID()}-${filename}`;
      return await this.storage.uploadBuffer(key, file.buffer, file.mimetype);
    } catch (err) {
      this.logger.warn(`Original file not archived (${(err as Error).message}) — keeping extracted text only`);
      return null;
    }
  }
}

/** An analysis that could not say anything is recorded as FAILED, not as an empty READY. */
function statusFor(analysis: AnalyzedDocument): WorkspaceAnalysisStatus {
  return analysis.findings.length > 0 && analysis.summary.trim().length > 0
    ? WorkspaceAnalysisStatus.READY
    : WorkspaceAnalysisStatus.FAILED;
}

/**
 * Strips any path component a client may have sent, drops control characters
 * (a filename is echoed straight back into the analysis text) and bounds the
 * length.
 */
function sanitizeFilename(original: string): string {
  const base = (original ?? 'documento').split(/[\\/]/).pop() ?? 'documento';
  const printable = [...base].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
  return printable.join('').trim().slice(0, 180) || 'documento';
}

function firstSentence(bio: string): string {
  const clean = bio.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Prestador na VIBE MATCH';
  const stop = clean.search(/[.!?]/);
  const sentence = stop > 20 ? clean.slice(0, stop) : clean;
  return sentence.length > 140 ? `${sentence.slice(0, 140).trimEnd()}…` : sentence;
}

function overlap(providerSkills: string[], wanted: string[]): number {
  return providerSkills.filter((skill) => wanted.includes(skill)).length;
}

/** Narrows a batch-loaded provider list down to one analysis's own skills. */
function pickProviders(providers: MatchedProvider[], skills: string[]): MatchedProvider[] {
  if (skills.length === 0) return [];
  return providers.filter((provider) => overlap(provider.skills, skills) > 0).slice(0, MAX_MATCHED_PROVIDERS);
}
