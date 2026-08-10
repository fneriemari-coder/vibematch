import { IsEnum } from 'class-validator';
import { Currency, SubscriptionTier } from '@prisma/client';

export class CreateCheckoutDto {
  @IsEnum(SubscriptionTier)
  planTier: SubscriptionTier;

  @IsEnum(Currency)
  currency: Currency;
}
