import { SetMetadata } from '@nestjs/common';

export const ENFORCE_SWIPE_LIMIT_KEY = 'enforceSwipeLimit';

/**
 * Marks a route as subject to the FREE-tier daily swipe cap. Combine with
 * SubscriptionGuard — PREMIUM_CLIENT/PRO_PROVIDER subscribers bypass the cap
 * entirely; FREE (or no subscription) is capped at SubscriptionGuard's
 * FREE_DAILY_SWIPE_LIMIT and gets HTTP 402 once exhausted for the day.
 */
export const EnforceSwipeLimit = () => SetMetadata(ENFORCE_SWIPE_LIMIT_KEY, true);
