import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LazyOpenAI } from '../../common/ai/lazy-openai';

export interface ModerationVerdict {
  allowed: boolean;
  reason?: string;
}

const CONTEXT_CHECK_SCHEMA = {
  name: 'context_relevance_check',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      inScope: {
        type: 'boolean',
        description:
          'TRUE if the content belongs to digital/corporate services (AI, design, programming, video) ' +
          'or local physical residential services. FALSE otherwise.',
      },
    },
    required: ['inScope'],
    additionalProperties: false,
  },
} as const;

/**
 * "VibeAiOrchestrator" — Agent 3: real-time moderation + on-topic ordering.
 * Gates every user-submitted Discovery Feed post through two independent
 * checks before it's allowed to persist as PUBLISHED:
 *   1. OpenAI's Moderation API — violence, hate speech, explicit content.
 *   2. A context-relevance classifier — is this even a services-marketplace
 *      post (digital/corporate or local/residential), or off-topic noise?
 * Either check failing blocks the post.
 */
@Injectable()
export class AiModeratorService {
  private readonly logger = new Logger(AiModeratorService.name);
  private readonly openai: LazyOpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openai = new LazyOpenAI(this.config.get('OPENAI_API_KEY'), this.logger, 'content moderation');
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  async moderate(contentText: string, tags: string[]): Promise<ModerationVerdict> {
    const [safetyVerdict, contextVerdict] = await Promise.all([
      this.checkSafety(contentText),
      this.checkContext(contentText, tags),
    ]);

    if (!safetyVerdict.allowed) return safetyVerdict;
    if (!contextVerdict.allowed) return contextVerdict;
    return { allowed: true };
  }

  private async checkSafety(contentText: string): Promise<ModerationVerdict> {
    try {
      const result = await this.openai.moderations.create({
        model: 'omni-moderation-latest',
        input: contentText,
      });
      const flagged = result.results[0]?.flagged ?? false;
      if (flagged) {
        const categories = result.results[0]?.categories ?? {};
        const triggered = Object.entries(categories)
          .filter(([, value]) => value)
          .map(([key]) => key);
        return { allowed: false, reason: `Flagged by safety moderation: ${triggered.join(', ') || 'unspecified'}` };
      }
      return { allowed: true };
    } catch (err) {
      this.logger.warn(`Safety moderation call failed, failing closed: ${(err as Error).message}`);
      // Fail closed — an unmoderatable post should never silently publish.
      return { allowed: false, reason: 'Moderation service unavailable' };
    }
  }

  private async checkContext(contentText: string, tags: string[]): Promise<ModerationVerdict> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: CONTEXT_CHECK_SCHEMA },
        messages: [
          {
            role: 'system',
            content:
              'Este conteúdo pertence ao nicho de serviços digitais/corporativos (IA, design, programação, ' +
              'vídeo) ou serviços físicos residenciais locais? Responda estritamente com o campo booleano inScope.',
          },
          { role: 'user', content: `Tags: ${tags.join(', ')}\n\nConteúdo: ${contentText}` },
        ],
      });
      const raw = completion.choices[0]?.message?.content;
      if (!raw) throw new Error('Empty completion');
      const { inScope } = JSON.parse(raw) as { inScope: boolean };
      return inScope ? { allowed: true } : { allowed: false, reason: 'Fora do escopo de serviços do VIBE MATCH' };
    } catch (err) {
      this.logger.warn(`Context check failed, failing closed: ${(err as Error).message}`);
      return { allowed: false, reason: 'Context check unavailable' };
    }
  }
}
