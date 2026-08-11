import { Logger, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

/**
 * Defers OpenAI client construction until the first actual API call.
 *
 * The SDK throws from its own constructor when the key is missing or empty.
 * These clients were previously built in service constructors, which made
 * OPENAI_API_KEY a hard requirement to *boot*: a deployment without it failed
 * Nest's bootstrap outright and never served a single request — health check
 * included. That's the wrong blast radius. Auth, escrow, wallet, chat, the
 * feed and course purchases have nothing to do with OpenAI and should run
 * fine without it; only the handful of endpoints that genuinely call out to
 * the API should care that it isn't configured.
 *
 * Exposes the same `chat` / `moderations` surface the call sites already use,
 * so services keep reading as `this.openai.chat.completions.create(...)`.
 */
export class LazyOpenAI {
  private client?: OpenAI;

  constructor(
    private readonly apiKey: string | undefined,
    logger: Logger,
    feature: string,
  ) {
    if (!apiKey) {
      logger.warn(`OPENAI_API_KEY not set — ${feature} will fail until it is configured`);
    }
  }

  /** Lets callers branch before paying for a request they know will fail. */
  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  get chat(): OpenAI['chat'] {
    return this.resolve().chat;
  }

  get moderations(): OpenAI['moderations'] {
    return this.resolve().moderations;
  }

  private resolve(): OpenAI {
    if (!this.apiKey) {
      // 503, not 500: the request is fine, the deployment is missing a
      // credential. Callers that already fail closed (AiModeratorService)
      // catch this and keep their own semantics.
      throw new ServiceUnavailableException(
        'Recurso de IA indisponível: OPENAI_API_KEY não está configurada neste ambiente.',
      );
    }
    return (this.client ??= new OpenAI({ apiKey: this.apiKey }));
  }
}
