import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { MaintenanceStatus, TicketSeverity, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushNotificationService } from '../notifications/push-notification.service';

const SIMULATED_ERROR_LOGS = [
  '502 Bad Gateway — upstream health check failing on /api/health',
  'Database connection pool exhausted (timeout after 30s)',
  'SSL certificate expiring in <24h — auto-renewal failed',
  'Memory usage at 94% — process restarted 3x in the last hour',
  'Background job queue backed up (>500 pending jobs)',
];

const HEALTH_CHECK_TIMEOUT_MS = 8_000;

/**
 * "AI Infrastructure Watcher" — hourly uptime sweep across active
 * maintenance contracts. Two modes, chosen per-agreement:
 *   - REAL: if `MaintenanceAgreement.hostingUrl` is set, does an actual HTTP
 *     GET against it and treats a non-2xx status or a timeout as a failure.
 *   - SIMULATED: no URL on file (the common case for now, since hostingUrl
 *     isn't collected anywhere in onboarding yet) — falls back to a random
 *     simulated failure, clearly tagged `[SIMULATED]` in the ticket so it's
 *     never confused with a real incident downstream.
 */
@Injectable()
export class AiWatcherService {
  private readonly logger = new Logger(AiWatcherService.name);
  private readonly simulatedFailureRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushNotificationService: PushNotificationService,
    private readonly config: ConfigService,
  ) {
    this.simulatedFailureRate = Number(this.config.get('AI_WATCHER_SIMULATED_FAILURE_RATE') ?? '0.05');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scanHostedApplications(): Promise<void> {
    const agreements = await this.prisma.maintenanceAgreement.findMany({
      where: { status: MaintenanceStatus.ACTIVE, hostingIncluded: true },
      include: { client: { include: { profile: true } }, provider: { include: { profile: true } } },
    });

    if (agreements.length === 0) return;

    let failuresDetected = 0;
    for (const agreement of agreements) {
      const failure = agreement.hostingUrl
        ? await this.realHealthCheck(agreement.hostingUrl)
        : this.simulateHealthCheck();
      if (!failure) continue;

      failuresDetected++;
      const ticket = await this.prisma.aITicketMonitor.create({
        data: {
          agreementId: agreement.id,
          errorLog: failure.errorLog,
          severityLevel: failure.severity,
          status: TicketStatus.OPEN,
          // No per-project tag exists in the schema — the provider's own
          // skills are the closest honest signal for "what domain did this
          // failure touch," and drive ai-retention-push.service.ts.
          relatedTags: agreement.provider.profile?.skills ?? [],
        },
      });

      const clientName = agreement.client.profile?.name ?? 'seu cliente';
      await this.pushNotificationService.sendUrgentAlert(
        agreement.providerId,
        'Alerta crítico ⚠️',
        `O sistema do seu cliente ${clientName} apresentou instabilidade. Corrija em até 60 minutos para proteger seu K-SCORE.`,
        { ticketId: ticket.id, agreementId: agreement.id, severity: failure.severity },
      );

      this.logger.warn(
        `Ticket ${ticket.id} opened (${failure.severity}) for agreement ${agreement.id} — provider ${agreement.providerId} alerted`,
      );
    }

    this.logger.log(`AI watcher sweep: ${agreements.length} agreement(s) checked, ${failuresDetected} failure(s) detected`);
  }

  private async realHealthCheck(url: string): Promise<{ errorLog: string; severity: TicketSeverity } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (response.ok) return null;
      return {
        errorLog: `HTTP ${response.status} from ${url}`,
        severity: response.status >= 500 ? TicketSeverity.HIGH : TicketSeverity.LOW,
      };
    } catch (err) {
      return { errorLog: `Health check failed for ${url}: ${(err as Error).message}`, severity: TicketSeverity.HIGH };
    } finally {
      clearTimeout(timeout);
    }
  }

  private simulateHealthCheck(): { errorLog: string; severity: TicketSeverity } | null {
    if (Math.random() > this.simulatedFailureRate) return null;

    const errorLog = SIMULATED_ERROR_LOGS[Math.floor(Math.random() * SIMULATED_ERROR_LOGS.length)];
    const severity = Math.random() < 0.4 ? TicketSeverity.HIGH : TicketSeverity.LOW;
    return { errorLog: `[SIMULATED] ${errorLog}`, severity };
  }
}
