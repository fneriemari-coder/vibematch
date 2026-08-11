import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushNotificationService } from '../notifications/push-notification.service';

/** Liveness/readiness probe — real DB round-trip, not a hardcoded 200. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly push: PushNotificationService,
  ) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'error', db: 'down', message: (err as Error).message });
    }
    return { status: 'ok', db: 'up', timestamp: new Date().toISOString() };
  }

  /**
   * Which optional integrations this deployment actually has credentials for.
   *
   * Emits booleans only — never a key, a prefix, or a length, since anything
   * derived from a secret leaks a little of it and this route is public.
   *
   * Exists because verifying "did that environment variable land?" otherwise
   * requires dashboard log access, which is slow and easy to misread. `push`
   * reports whether Firebase Admin actually initialised, not merely whether a
   * variable is present — a malformed credential is set but not working, and
   * that is exactly the case worth catching.
   */
  @Get('integrations')
  integrations() {
    const isSet = (key: string) => Boolean(this.config.get<string>(key));
    return {
      database: true, // reaching this handler at all means Prisma connected
      push: this.push.isEnabled,
      stripe: isSet('STRIPE_SECRET_KEY'),
      stripeWebhook: isSet('STRIPE_WEBHOOK_SECRET'),
      openai: isSet('OPENAI_API_KEY'),
      storage: isSet('AWS_ACCESS_KEY_ID') && isSet('AWS_SECRET_ACCESS_KEY'),
      email: isSet('SMTP_HOST'),
      timestamp: new Date().toISOString(),
    };
  }
}
