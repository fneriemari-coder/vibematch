import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushNotificationService } from './push-notification.service';

/**
 * Every 30 minutes, sweeps DiscoveryPost for the last 24h looking for posts
 * whose velocity score ((likes * 2) + views) crossed the virality threshold
 * and haven't been notified yet, then hands each off to PushNotificationService.
 * `trendNotifiedAt` is set immediately after a successful send so a post is
 * ever only alerted once, even across overlapping cron runs.
 */
@Injectable()
export class TrendMonitorService {
  private readonly logger = new Logger(TrendMonitorService.name);
  private readonly threshold: number;
  private readonly windowHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushNotificationService: PushNotificationService,
    private readonly config: ConfigService,
  ) {
    this.threshold = Number(this.config.get('TREND_VIRALITY_THRESHOLD') ?? '500');
    this.windowHours = Number(this.config.get('TREND_SCAN_WINDOW_HOURS') ?? '24');
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scanForViralPosts(): Promise<void> {
    const since = new Date(Date.now() - this.windowHours * 60 * 60 * 1000);

    const candidates = await this.prisma.discoveryPost.findMany({
      where: { createdAt: { gte: since }, trendNotifiedAt: null },
      include: { tags: true },
    });

    const viral = candidates.filter(
      (post) => post.likesCount * 2 + post.viewsCount > this.threshold,
    );

    if (viral.length === 0) return;
    this.logger.log(`Trend scan: ${viral.length} post(s) crossed the virality threshold`);

    for (const post of viral) {
      try {
        await this.pushNotificationService.sendTrendAlert(post, post.tags);
        await this.prisma.discoveryPost.update({
          where: { id: post.id },
          data: { trendNotifiedAt: new Date() },
        });
      } catch (err) {
        this.logger.error(`Failed to send trend alert for post ${post.id}: ${(err as Error).message}`);
      }
    }
  }
}
