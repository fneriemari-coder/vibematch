import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SUBSCRIPTION_TIERS_KEY } from '../decorators/subscription-tiers.decorator';
import { ENFORCE_SWIPE_LIMIT_KEY } from '../decorators/enforce-swipe-limit.decorator';

/**
 * Gates SaaS Pro features (translated chat, Kanban board, receivables advance,
 * unlimited matches, AI-powered filters, etc.) behind Subscription.tier, and
 * enforces the FREE-tier daily swipe cap on routes marked @EnforceSwipeLimit().
 * Must run after JwtAuthGuard so `request.user` is already populated.
 *
 * A route with neither @RequireTier(...) nor @EnforceSwipeLimit() metadata is
 * left open — this guard is opt-in per route, not a blanket paywall.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  // FREE-tier users get this many swipes per rolling calendar day before /swipes
  // starts returning 402 Payment Required with a paywall-redirect payload.
  private static readonly FREE_DAILY_SWIPE_LIMIT = 10;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredTiers = this.reflector.getAllAndOverride<SubscriptionTier[]>(
      SUBSCRIPTION_TIERS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const swipeLimitEnforced = this.reflector.getAllAndOverride<boolean>(
      ENFORCE_SWIPE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if ((!requiredTiers || requiredTiers.length === 0) && !swipeLimitEnforced) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    const isActive =
      subscription?.status === SubscriptionStatus.ACTIVE &&
      (!subscription.expiresAt || subscription.expiresAt > new Date());

    if (requiredTiers && requiredTiers.length > 0) {
      if (!isActive || !requiredTiers.includes(subscription.tier)) {
        throw new ForbiddenException(
          `This feature requires one of the following plans: ${requiredTiers.join(', ')}`,
        );
      }
    }

    if (swipeLimitEnforced) {
      const isPaidTier =
        isActive &&
        (subscription.tier === SubscriptionTier.PREMIUM_CLIENT ||
          subscription.tier === SubscriptionTier.PRO_PROVIDER);

      if (!isPaidTier) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const swipesToday = await this.prisma.swipe.count({
          where: { swiperId: userId, createdAt: { gte: startOfDay } },
        });

        if (swipesToday >= SubscriptionGuard.FREE_DAILY_SWIPE_LIMIT) {
          throw new HttpException(
            {
              statusCode: HttpStatus.PAYMENT_REQUIRED,
              error: 'Payment Required',
              message: `Daily free swipe limit (${SubscriptionGuard.FREE_DAILY_SWIPE_LIMIT}) reached`,
              redirect: 'PAYWALL',
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
      }
    }

    return true;
  }
}
