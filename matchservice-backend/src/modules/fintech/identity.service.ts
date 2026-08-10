import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Stripe Identity integration — biometric (selfie) + government-ID
 * verification, required once a user crosses the volume/K-Score-drop
 * triggers enforced by AntiFraudGuard. This service only opens the
 * verification session; `identityVerified` flips to true when Stripe's
 * `identity.verification_session.verified` webhook lands (see
 * stripe-webhook.service.ts) — never on the client's say-so.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  async createVerificationSession(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const session = await this.stripe.identity.verificationSessions.create({
      type: 'document',
      options: {
        document: {
          require_matching_selfie: true,
          require_live_capture: true,
        },
      },
      metadata: { userId },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeIdentitySessionId: session.id },
    });

    this.logger.log(`Identity verification session ${session.id} created for user ${userId}`);

    return { sessionId: session.id, clientSecret: session.client_secret, url: session.url };
  }
}
