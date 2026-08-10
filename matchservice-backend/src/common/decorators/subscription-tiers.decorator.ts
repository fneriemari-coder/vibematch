import { SetMetadata } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';

export const SUBSCRIPTION_TIERS_KEY = 'subscriptionTiers';

/**
 * Gates a route to callers whose active Subscription.tier is one of `tiers`.
 * Combine with SubscriptionGuard. Example:
 *
 *   @RequireTier(SubscriptionTier.PRO_PROVIDER)
 *   @UseGuards(JwtAuthGuard, SubscriptionGuard)
 *   @Post('advance')
 *   advance(...) {}
 */
export const RequireTier = (...tiers: SubscriptionTier[]) =>
  SetMetadata(SUBSCRIPTION_TIERS_KEY, tiers);
