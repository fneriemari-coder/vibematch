import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EscrowStatus, SubscriptionTier, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { COURSE_GENERATED_EVENT, CourseGeneratedEvent } from './events/course-generated.event';

const CORRELATION_WINDOW_HOURS = 168; // 7 days

/**
 * "AiRetentionNotificationService" — event-driven correlation engine.
 * Whenever a new course finishes generating (see AiFactoryService), this
 * listener finds users who recently suffered a failure/dispute touching the
 * same skill tags and pushes them straight at the course that fixes it.
 *
 * Runs as a fire-and-forget @OnEvent handler: course generation itself must
 * never fail or slow down because this correlation/send step had a problem,
 * so every step here is wrapped and logged rather than thrown.
 */
@Injectable()
export class AiRetentionPushService {
  private readonly logger = new Logger(AiRetentionPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  @OnEvent(COURSE_GENERATED_EVENT, { async: true })
  async handleCourseGenerated(event: CourseGeneratedEvent): Promise<void> {
    try {
      await this.correlateAndNotify(event);
    } catch (err) {
      this.logger.error(`Retention push failed for course ${event.courseId}: ${(err as Error).message}`);
    }
  }

  private async correlateAndNotify(event: CourseGeneratedEvent): Promise<void> {
    if (event.skillsTaught.length === 0) return;

    const since = new Date(Date.now() - CORRELATION_WINDOW_HOURS * 60 * 60 * 1000);
    const affectedUserIds = await this.findAffectedUsers(event.skillsTaught, since);
    if (affectedUserIds.length === 0) {
      this.logger.debug(`No affected users found for course ${event.courseId} (tags: ${event.skillsTaught.join(', ')})`);
      return;
    }

    // Only PREMIUM_CLIENT or FREE-tier users, per spec — PRO_PROVIDER isn't
    // the target audience for "your hosted app broke" retention content.
    const eligibleUserIds = await this.filterByTier(affectedUserIds, [SubscriptionTier.PREMIUM_CLIENT, SubscriptionTier.FREE]);
    if (eligibleUserIds.length === 0) return;

    const primaryTag = event.skillsTaught[0];
    await this.pushNotificationService.sendMulticastAlert(
      eligibleUserIds,
      `Seu sistema apresentou um erro de ${primaryTag}? Veja como resolver agora. 🔥`,
      'A IA do VIBE MATCH acaba de lançar um minicurso de 5 minutos ensinando o plano de ação exato para blindar seu negócio desse problema. Assista já!',
      { course_id: event.courseId, redirect: 'VIBE_ACADEMY_COURSE', tag: primaryTag },
    );

    this.logger.log(
      `Retention push sent for course ${event.courseId} (tags: ${event.skillsTaught.join(', ')}) to ${eligibleUserIds.length} eligible user(s)`,
    );
  }

  /**
   * Two independent sources of "this user recently had a problem in this
   * skill area," unioned:
   *   (a) The client on a MaintenanceAgreement with an OPEN AITicketMonitor
   *       whose relatedTags overlap the course's tags.
   *   (b) The client on a DISPUTED EscrowProject whose provider's own
   *       UserProfile.skills overlap the course's tags (no per-project tag
   *       exists in the schema, so the provider's skills are the closest
   *       honest signal for "what domain this project touched").
   */
  private async findAffectedUsers(tags: string[], since: Date): Promise<string[]> {
    const [ticketAgreements, disputedProjects] = await Promise.all([
      this.prisma.maintenanceAgreement.findMany({
        where: {
          tickets: { some: { status: TicketStatus.OPEN, detectedAt: { gte: since }, relatedTags: { hasSome: tags } } },
        },
        select: { clientId: true },
      }),
      this.prisma.escrowProject.findMany({
        where: {
          status: EscrowStatus.DISPUTED,
          disputedAt: { gte: since },
          provider: { profile: { skills: { hasSome: tags } } },
        },
        select: { clientId: true },
      }),
    ]);

    const ids = new Set<string>();
    ticketAgreements.forEach((a) => ids.add(a.clientId));
    disputedProjects.forEach((p) => ids.add(p.clientId));
    return Array.from(ids);
  }

  private async filterByTier(userIds: string[], tiers: SubscriptionTier[]): Promise<string[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, tier: true, status: true },
    });

    const subscribedIds = new Set(
      subscriptions.filter((s) => tiers.includes(s.tier)).map((s) => s.userId),
    );
    // A user with no Subscription row at all is FREE by default (see
    // AuthService.register) and therefore eligible if FREE is in `tiers`.
    const hasNoSubscription = new Set(userIds.filter((id) => !subscriptions.some((s) => s.userId === id)));
    if (tiers.includes(SubscriptionTier.FREE)) {
      hasNoSubscription.forEach((id) => subscribedIds.add(id));
    }

    return userIds.filter((id) => subscribedIds.has(id));
  }
}
