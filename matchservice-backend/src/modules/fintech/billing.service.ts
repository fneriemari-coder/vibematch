import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Currency, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Creates Stripe Checkout sessions for the paywall's "Ativar Acesso Premium
 * Instantâneo" CTA. Locale drives currency (BR -> BRL/Pix, else USD/Apple
 * Pay) and plan tier drives which Price is charged — see .env.example for
 * the four STRIPE_PRICE_* IDs this reads from.
 */
@Injectable()
export class BillingService {
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  async createCheckoutSession(userId: string, planTier: SubscriptionTier, currency: Currency) {
    if (planTier === SubscriptionTier.FREE) {
      throw new BadRequestException('FREE is not a purchasable plan');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const priceId = this.priceIdFor(planTier, currency);
    if (!priceId) {
      throw new BadRequestException(`No Stripe price configured for ${planTier}/${currency}`);
    }

    let subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    let stripeCustomerId = subscription?.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        metadata: { userId },
      });
      stripeCustomerId = customer.id;
      subscription = await this.prisma.subscription.upsert({
        where: { userId },
        update: { stripeCustomerId, currency },
        create: { userId, stripeCustomerId, currency },
      });
    }

    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/paywall/success`,
      cancel_url: `${appUrl}/paywall/cancel`,
      metadata: { userId, planTier },
    });

    return { checkoutUrl: session.url };
  }

  private priceIdFor(planTier: SubscriptionTier, currency: Currency): string | undefined {
    const key =
      planTier === SubscriptionTier.PREMIUM_CLIENT
        ? `STRIPE_PRICE_PREMIUM_CLIENT_${currency}`
        : `STRIPE_PRICE_PRO_PROVIDER_${currency}`;
    return this.config.get<string>(key);
  }
}
