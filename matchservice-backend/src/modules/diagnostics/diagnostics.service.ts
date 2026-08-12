import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrowthDiagnostic, GrowthPillar } from '@prisma/client';
import { LazyOpenAI } from '../../common/ai/lazy-openai';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateDiagnosticDto } from './dto/create-diagnostic.dto';
import {
  AnalyzedDiagnostic,
  MARKET_SKILL_TAGS,
  analyzeSituation,
  pickWeakestPillar,
} from './growth-analyzer';

/**
 * Strict JSON schema for the model path — same shape `quiz-generator.service.ts`
 * uses, for the same reason: a free-form completion that has to be parsed
 * defensively is a completion that eventually returns prose instead of JSON.
 *
 * `suggestedSkills` is constrained to the platform's real skill vocabulary by
 * enum. That is the single most important line in this file: a suggested skill
 * that no provider profile carries makes the diagnostic unmatched and the
 * "education originates business" loop dead.
 */
const DIAGNOSTIC_SCHEMA = {
  name: 'growth_diagnostic',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      scoreVendas: { type: 'integer', minimum: 0, maximum: 100 },
      scoreGestao: { type: 'integer', minimum: 0, maximum: 100 },
      scoreTecnologia: { type: 'integer', minimum: 0, maximum: 100 },
      scoreFinancas: { type: 'integer', minimum: 0, maximum: 100 },
      weakestPillar: { type: 'string', enum: ['VENDAS', 'GESTAO', 'TECNOLOGIA', 'FINANCAS'] },
      summary: { type: 'string' },
      recommendations: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 4 },
      suggestedSkills: {
        type: 'array',
        items: { type: 'string', enum: [...MARKET_SKILL_TAGS] },
        minItems: 2,
        maxItems: 5,
      },
    },
    required: [
      'scoreVendas',
      'scoreGestao',
      'scoreTecnologia',
      'scoreFinancas',
      'weakestPillar',
      'summary',
      'recommendations',
      'suggestedSkills',
    ],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT =
  'Você é o analista de diagnóstico de crescimento da VIBE MATCH, uma plataforma brasileira que conecta ' +
  'gestores a cursos, mentores e prestadores de serviço. Um gestor descreve, em texto livre, o problema que ' +
  'está vivendo na empresa dele. Sua tarefa é pontuar a empresa de 0 a 100 em exatamente quatro pilares — ' +
  'Vendas, Gestão, Tecnologia e Finanças — onde 100 é excelente e nota baixa significa fragilidade evidenciada ' +
  'pelo relato.\n\n' +
  'Regras obrigatórias:\n' +
  '1. Pontue apenas com base no que o gestor escreveu. Pilar não mencionado fica em 70 (linha de base, ' +
  'significa "sem evidência", não "está bom"). Nunca invente uma fraqueza que o texto não sustenta.\n' +
  '2. O resumo deve citar entre aspas trechos literais do que o gestor escreveu e explicar o mecanismo do ' +
  'problema — por que aquilo causa o que causa. Nada de conselho genérico de autoajuda empresarial.\n' +
  '3. As recomendações são ações concretas de primeira semana, na ordem em que devem ser executadas, ' +
  'começando pelo pilar mais fraco.\n' +
  '4. suggestedSkills deve conter as competências de mercado que o gestor precisa contratar para resolver o ' +
  'pilar mais fraco, escolhidas SOMENTE da lista permitida.\n' +
  '5. Escreva tudo em português do Brasil, na segunda pessoa, direto e sem jargão.';

interface ModelDiagnostic {
  scoreVendas: number;
  scoreGestao: number;
  scoreTecnologia: number;
  scoreFinancas: number;
  weakestPillar: GrowthPillar;
  summary: string;
  recommendations: string[];
  suggestedSkills: string[];
}

/** The public response shape. Contract shared with the Flutter radar screen. */
export interface DiagnosticResponse {
  id: string;
  situation: string;
  pillars: { vendas: number; gestao: number; tecnologia: number; financas: number };
  weakestPillar: GrowthPillar;
  summary: string;
  recommendations: string[];
  suggestedSkills: string[];
  aiGenerated: boolean;
  createdAt: Date;
}

/**
 * Growth diagnostics — the platform's differentiator.
 *
 * A manager describes a business problem in plain text; the company is scored
 * across the four GrowthPillar axes and rendered as a radar chart. The weakest
 * pillar is what the rest of the platform recommends against, and
 * `suggestedSkills` carries real market tags so the reading can be handed
 * straight to provider matching.
 *
 * Two paths produce the same shape. The model path runs through `LazyOpenAI`
 * (never a directly constructed OpenAI client — a missing key must not be able
 * to kill boot). The local path, `growth-analyzer.ts`, is a real analyser, not
 * a stub, and is the path that runs whenever the key is missing OR the call
 * fails for any reason at all. `aiGenerated` records which one ran.
 */
@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger(DiagnosticsService.name);
  private readonly openai: LazyOpenAI;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.openai = new LazyOpenAI(
      this.config.get('OPENAI_API_KEY'),
      this.logger,
      'model-scored growth diagnostics (the local analyser covers it meanwhile)',
    );
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  async create(userId: string, dto: CreateDiagnosticDto): Promise<DiagnosticResponse> {
    const situation = dto.situation.trim();
    const { analysis, aiGenerated } = await this.analyze(situation);

    const diagnostic = await this.prisma.growthDiagnostic.create({
      data: {
        userId,
        situation,
        scoreVendas: analysis.scores.VENDAS,
        scoreGestao: analysis.scores.GESTAO,
        scoreTecnologia: analysis.scores.TECNOLOGIA,
        scoreFinancas: analysis.scores.FINANCAS,
        weakestPillar: analysis.weakestPillar,
        summary: analysis.summary,
        recommendations: analysis.recommendations,
        suggestedSkills: analysis.suggestedSkills,
        aiGenerated,
      },
    });

    this.logger.log(
      `Diagnostic ${diagnostic.id} created for user ${userId} — weakest ${analysis.weakestPillar} ` +
        `(${analysis.scores[analysis.weakestPillar]}/100), source ${aiGenerated ? 'model' : 'local analyser'}`,
    );

    return this.toResponse(diagnostic);
  }

  async listForUser(userId: string): Promise<DiagnosticResponse[]> {
    const diagnostics = await this.prisma.growthDiagnostic.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return diagnostics.map((d) => this.toResponse(d));
  }

  /**
   * Owner-only. A diagnostic is the most personal thing on this platform —
   * it is a manager writing down what is going wrong in their company — so the
   * ownership check is unconditional here rather than folded into the query,
   * and it answers 403 (not 404) so the rule is legible in the logs. Same
   * lesson as the escrow IDOR: never serve a row just because its id was
   * guessed.
   */
  async findOne(userId: string, id: string): Promise<DiagnosticResponse> {
    const diagnostic = await this.prisma.growthDiagnostic.findUnique({ where: { id } });
    if (!diagnostic) throw new NotFoundException('Diagnóstico não encontrado');
    if (diagnostic.userId !== userId) {
      throw new ForbiddenException('Você só pode acessar os seus próprios diagnósticos');
    }
    return this.toResponse(diagnostic);
  }

  /**
   * Model first, local analyser as the guaranteed floor.
   *
   * Every failure mode collapses to the same branch on purpose: no key, a
   * 401 from a stale key, a network the sandbox blocks, a rate limit, a
   * malformed completion. None of them are the caller's problem, and none of
   * them justify returning a diagnostic that says nothing.
   */
  private async analyze(
    situation: string,
  ): Promise<{ analysis: AnalyzedDiagnostic; aiGenerated: boolean }> {
    if (!this.openai.isConfigured) {
      this.logger.warn('OPENAI_API_KEY not configured — scoring with the local growth analyser');
      return { analysis: analyzeSituation(situation), aiGenerated: false };
    }

    try {
      const analysis = await this.analyzeWithModel(situation);
      return { analysis, aiGenerated: true };
    } catch (err) {
      this.logger.warn(
        `Growth diagnostic model call failed (${(err as Error).message}) — falling back to the local analyser`,
      );
      return { analysis: analyzeSituation(situation), aiGenerated: false };
    }
  }

  private async analyzeWithModel(situation: string): Promise<AnalyzedDiagnostic> {
    const completion = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: DIAGNOSTIC_SCHEMA },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: situation },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty completion from OpenAI while scoring a growth diagnostic');

    const parsed = JSON.parse(raw) as ModelDiagnostic;
    return this.normalizeModelOutput(parsed);
  }

  /**
   * Trusts the model for the writing, never for the invariants.
   *
   * Scores are clamped into range, `weakestPillar` is RE-DERIVED from the
   * scores rather than taken on faith (a radar whose lowest axis disagrees
   * with the pillar the copy talks about is the kind of thing nobody catches
   * in review), and `suggestedSkills` is filtered against the real vocabulary
   * even though the schema already constrains it. A model reply that survives
   * none of this is treated as a failure and the local analyser takes over.
   */
  private normalizeModelOutput(parsed: ModelDiagnostic): AnalyzedDiagnostic {
    const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
    const scores: Record<GrowthPillar, number> = {
      VENDAS: clamp(parsed.scoreVendas),
      GESTAO: clamp(parsed.scoreGestao),
      TECNOLOGIA: clamp(parsed.scoreTecnologia),
      FINANCAS: clamp(parsed.scoreFinancas),
    };

    const emptySignals = { VENDAS: [], GESTAO: [], TECNOLOGIA: [], FINANCAS: [] };
    const weakestPillar = pickWeakestPillar(scores, emptySignals);
    if (parsed.weakestPillar !== weakestPillar) {
      this.logger.warn(
        `Model reported weakestPillar=${parsed.weakestPillar} but the lowest score is ${weakestPillar} — ` +
          'using the score-derived pillar so the radar and the copy cannot disagree',
      );
    }

    const allowed = new Set<string>(MARKET_SKILL_TAGS);
    const suggestedSkills = [...new Set(parsed.suggestedSkills)].filter((skill) => allowed.has(skill));
    const recommendations = parsed.recommendations.map((r) => r.trim()).filter(Boolean);

    if (!parsed.summary?.trim() || recommendations.length === 0 || suggestedSkills.length === 0) {
      throw new Error('Model returned a diagnostic with no usable summary, recommendations or skills');
    }

    return { scores, weakestPillar, summary: parsed.summary.trim(), recommendations, suggestedSkills };
  }

  private toResponse(diagnostic: GrowthDiagnostic): DiagnosticResponse {
    return {
      id: diagnostic.id,
      situation: diagnostic.situation,
      pillars: {
        vendas: diagnostic.scoreVendas,
        gestao: diagnostic.scoreGestao,
        tecnologia: diagnostic.scoreTecnologia,
        financas: diagnostic.scoreFinancas,
      },
      weakestPillar: diagnostic.weakestPillar,
      summary: diagnostic.summary,
      recommendations: diagnostic.recommendations,
      suggestedSkills: diagnostic.suggestedSkills,
      aiGenerated: diagnostic.aiGenerated,
      createdAt: diagnostic.createdAt,
    };
  }
}
