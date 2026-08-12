import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LazyOpenAI } from '../../common/ai/lazy-openai';
import PDFDocument from 'pdfkit';
import { Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CourseCoverService } from './course-cover.service';
import { S3StorageService } from '../../common/storage/s3-storage.service';
import { GenerateAiCourseDto } from './dto/generate-ai-course.dto';
import { COURSE_GENERATED_EVENT, CourseGeneratedEvent } from '../ai/events/course-generated.event';

export interface GeneratedModule {
  title: string;
  voiceScript: string;
}

export interface GeneratedCourseScope {
  courseTitle: string;
  commercialDescription: string;
  // Market-standard SCREAMING_SNAKE_CASE skill/error tags this course
  // addresses, e.g. ['STRIPE_WEBHOOK', 'AI_AUTOMATION'] — drives both
  // GET /academy/course-connections/:courseId and the retention push
  // correlation in ai-retention-push.service.ts.
  skillsTaught: string[];
  modules: GeneratedModule[]; // exactly 3
}

const COURSE_SCOPE_SCHEMA = {
  name: 'executive_course_scope',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      courseTitle: { type: 'string' },
      commercialDescription: {
        type: 'string',
        description: 'Persuasive, benefit-led sales description — 2-4 sentences, written to convert a busy SMB owner.',
      },
      skillsTaught: {
        type: 'array',
        description: 'Exactly 3 market-standard SCREAMING_SNAKE_CASE tags for the skills/errors this course addresses (e.g. STRIPE_WEBHOOK, AI_AUTOMATION, LOCAL_SEO).',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
      },
      modules: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            voiceScript: {
              type: 'string',
              description: 'Full ~5-minute (roughly 700-900 word) spoken lesson script, first person, instructor voice, ready to feed to a text-to-speech/avatar video engine verbatim.',
            },
          },
          required: ['title', 'voiceScript'],
          additionalProperties: false,
        },
      },
    },
    required: ['courseTitle', 'commercialDescription', 'skillsTaught', 'modules'],
    additionalProperties: false,
  },
} as const;

const DEFAULT_PRICE_USD = 297;
const DEFAULT_PRICE_BRL = 997;

/**
 * Marker tag stamped onto every course this factory publishes, so the client
 * can badge it as "gerado por IA".
 *
 * `BusinessCourse` has no boolean for provenance, and `skillsTaught` is the
 * only client-visible, queryable string list on the model. Carrying the flag
 * here is harmless to the two consumers of that array
 * (GET /academy/course-connections/:courseId matches it against
 * `UserProfile.skills` / `PostTag.tagName`, and no profile or post ever
 * carries this tag), and it avoids polluting the course title. A dedicated
 * `isAiGenerated Boolean @default(false)` column would be the right home —
 * see the note in this module's README-level report.
 */
export const AI_GENERATED_COURSE_TAG = 'AI_GENERATED';

/**
 * "AiCourseFactoryService" — generates a complete 3-module executive course
 * (scope + voice scripts), simulates rendering each lesson to video, and
 * produces a real downloadable PDF support pack.
 *
 * Honesty note: there is no video rendering here. An avatar/voice engine
 * (HeyGen, ElevenLabs) is not integrated, so `videoUrl` is left NULL and the
 * lesson ships as its written script plus the material pack.
 *
 * This used to return a deterministic S3 URL for an object that was never
 * uploaded. Every generated lesson therefore 404'd in the player, which reads
 * as a broken CDN rather than a feature we have not built — the worse of the
 * two failures, because it sends people looking for a bug that does not exist.
 * A null tells the client the truth and it already handles it.
 *
 * The PDF material pack IS real: rendered with pdfkit and uploaded to S3.
 */
@Injectable()
export class AiFactoryService {
  private readonly logger = new Logger(AiFactoryService.name);
  private readonly openai: LazyOpenAI;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: S3StorageService,
    private readonly eventEmitter: EventEmitter2,
    private readonly courseCovers: CourseCoverService,
  ) {
    this.openai = new LazyOpenAI(this.config.get('OPENAI_API_KEY'), this.logger, 'AI course generation');
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  async generateCourse(instructorId: string, dto: GenerateAiCourseDto) {
    const scope = await this.generateScope(dto.topicHint);
    return this.publishCourseFromScope(instructorId, scope);
  }

  /**
   * Persists an already-composed course scope: the BusinessCourse row, its
   * ordered modules (with simulated lesson videos) and the real PDF material
   * pack, then fires COURSE_GENERATED.
   *
   * Split out of `generateCourse` so a caller that produced the scope some
   * other way can reuse the whole publishing pipeline — specifically
   * `prisma/seed-ai-courses.ts`, which falls back to a deterministic local
   * composer when OPENAI_API_KEY is absent or the model call fails, and must
   * still end up with courses that are indistinguishable in shape from
   * model-generated ones.
   */
  async publishCourseFromScope(instructorId: string, scope: GeneratedCourseScope) {
    const instructor = await this.prisma.user.findUniqueOrThrow({ where: { id: instructorId } });

    const currency = instructor.country === 'BR' ? Currency.BRL : Currency.USD;
    const price = currency === Currency.BRL ? DEFAULT_PRICE_BRL : DEFAULT_PRICE_USD;

    // Provenance lives on `isAiGenerated`, not in `skillsTaught`. The marker
    // used to be pushed into that array, but it is the field matched against
    // provider profiles and post tags by getCourseConnections — a synthetic
    // entry there quietly skewed skill matching. Strip it if a round-tripped
    // scope names it, so the pollution cannot come back through the model.
    const skillsTaught = [...new Set(scope.skillsTaught)].filter(
      (skill) => skill !== AI_GENERATED_COURSE_TAG,
    );

    const course = await this.prisma.businessCourse.create({
      data: {
        instructorId,
        isAiGenerated: true,
        title: scope.courseTitle,
        description: scope.commercialDescription,
        price,
        currency,
        skillsTaught,
      },
    });

    const modules = [];
    for (let i = 0; i < scope.modules.length; i++) {
      const mod = scope.modules[i];
      const created = await this.prisma.courseModule.create({
        data: {
          courseId: course.id,
          orderIndex: i + 1,
          title: mod.title,
          voiceScript: mod.voiceScript,
          // Null until a real render exists — see the class doc.
          videoUrl: null,
        },
      });
      modules.push(created);
    }

    // The course and its modules are already committed at this point, so an
    // unconfigured (or momentarily unavailable) object store must not take the
    // whole generation down — that would leave a perfectly usable course behind
    // an error response. The PDF is an attachment, not the product.
    let materialDownloadUrl: string | null = null;
    try {
      materialDownloadUrl = await this.generateMaterialPdf(course.id, scope, modules);
    } catch (error) {
      this.logger.warn(
        `Course ${course.id} published without its PDF material pack: ${error instanceof Error ? error.message : error}`,
      );
    }

    // Cover art, on the same terms as the PDF: best-effort, and never a reason
    // to fail a course that already exists. `generateCoverFor` persists the URL
    // itself, so this runs before the update below and the returned row carries
    // it. A course that ends up without one still renders — the client draws a
    // seeded cover from the title whenever `mediaPreviewUrl` is null.
    if (this.courseCovers.isAvailable) {
      try {
        await this.courseCovers.generateCoverFor(course);
      } catch (error) {
        this.logger.warn(
          `Course ${course.id} published without cover art: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    const updatedCourse = await this.prisma.businessCourse.update({
      where: { id: course.id },
      data: { materialDownloadUrl },
    });

    this.logger.log(`AI-generated course "${scope.courseTitle}" (${course.id}) with ${modules.length} modules for instructor ${instructorId}`);

    // Fire-and-forget signal for ai-retention-push.service.ts — a listener
    // failure must never fail course generation itself, hence no `await`
    // and no try/catch needed here (EventEmitter2 swallows listener errors
    // by default; see AiRetentionPushService for its own internal handling).
    const event: CourseGeneratedEvent = { courseId: updatedCourse.id, skillsTaught: scope.skillsTaught };
    this.eventEmitter.emit(COURSE_GENERATED_EVENT, event);

    return { course: updatedCourse, modules };
  }

  private async generateScope(topicHint?: string): Promise<GeneratedCourseScope> {
    const completion = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.7,
      response_format: { type: 'json_schema', json_schema: COURSE_SCOPE_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            'Você é o Diretor de Conteúdo de uma plataforma de educação executiva corporativa. Crie a ementa de um curso executivo rápido de 3 módulos, ' +
            'baseado em dores reais de médias empresas (ex: Otimização de Fluxo de Caixa com IA, Arquitetura de CRMs ' +
            'de Alta Conversão, Automação de Atendimento). Cada módulo precisa de um script de voz completo de ' +
            '~5 minutos, pronto para virar aula em vídeo. Tom pragmático, direto, orientado a resultado — nada de ' +
            'enrolação genérica de curso online.',
        },
        {
          role: 'user',
          content: topicHint ? `Foco desejado: ${topicHint}` : 'Escolha o tema com maior potencial de conversão agora.',
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty completion from OpenAI while generating course scope');
    return JSON.parse(raw) as GeneratedCourseScope;
  }

  /**
   * PLACEHOLDER — simulates an AI video/voice rendering API (e.g.
   * ElevenLabs for voice + HeyGen for the talking-head video). Returns a
   * deterministic pseudo-URL; does not call any external service or upload
   * real media bytes, since none are actually generated here.
   */

  private async generateMaterialPdf(
    courseId: string,
    scope: GeneratedCourseScope,
    modules: Array<{ title: string }>,
  ): Promise<string> {
    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';
    const swipeDeckLink = `${appUrl}/academy/course-connections/${courseId}`;

    const buffer = await this.renderPdf(scope, modules, swipeDeckLink);
    return this.storage.uploadBuffer(`academy/materials/${courseId}.pdf`, buffer, 'application/pdf');
  }

  private renderPdf(
    scope: GeneratedCourseScope,
    modules: Array<{ title: string }>,
    swipeDeckLink: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(22).text(scope.courseTitle, { align: 'left' });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#555555').text('Resumo Executivo — VIBE MATCH Academy');
      doc.moveDown();

      doc.fillColor('#000000').fontSize(12).text(scope.commercialDescription);
      doc.moveDown();

      doc.fontSize(16).text('Checklist de Implementação');
      doc.moveDown(0.5);
      modules.forEach((mod, i) => {
        doc.fontSize(12).text(`☐  Módulo ${i + 1}: ${mod.title}`);
      });
      doc.moveDown();

      doc.fontSize(16).text('Próximo passo');
      doc.moveDown(0.5);
      doc
        .fontSize(12)
        .fillColor('#0a2540')
        .text('Pronto para executar essa estratégia na prática? Veja profissionais da VIBE MATCH prontos para ' +
          'implementar exatamente isso na sua empresa:');
      doc.fillColor('#2563eb').text(swipeDeckLink, { link: swipeDeckLink, underline: true });

      doc.end();
    });
  }
}
