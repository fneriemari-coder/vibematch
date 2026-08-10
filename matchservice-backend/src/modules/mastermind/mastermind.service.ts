import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConnectService } from '../fintech/connect.service';
import { CreateMastermindSessionDto } from './dto/create-session.dto';

// Same 80/20 split as VibeAcademy course sales (academy.service.ts) — kept
// as one constant so both revenue lines can diverge later without one
// change silently affecting the other.
const PLATFORM_TAKE_RATE = 0.2;
// A booking unlocks the stream this long before scheduledFor — early enough
// for someone to join and settle in, not so early it's really "before the
// session."
const EARLY_ACCESS_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class MastermindService {
  private readonly logger = new Logger(MastermindService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connectService: ConnectService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  async createSession(hostId: string, dto: CreateMastermindSessionDto) {
    const scheduledFor = new Date(dto.scheduledFor);
    if (scheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledFor must be in the future');
    }

    return this.prisma.liveMastermindSession.create({
      data: {
        hostId,
        title: dto.title,
        accessFee: new Prisma.Decimal(dto.accessFee),
        currency: dto.currency,
        scheduledFor,
        liveStreamUrl: dto.liveStreamUrl,
      },
    });
  }

  async setLiveStreamUrl(hostId: string, sessionId: string, liveStreamUrl: string) {
    const session = await this.prisma.liveMastermindSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.hostId !== hostId) {
      throw new ForbiddenException('Only the host can set the stream link');
    }
    return this.prisma.liveMastermindSession.update({ where: { id: sessionId }, data: { liveStreamUrl } });
  }

  /** Upcoming sessions only — past ones aren't bookable/joinable anymore. */
  async listUpcoming(limit = 20, offset = 0) {
    return this.prisma.liveMastermindSession.findMany({
      where: { scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
      skip: offset,
      include: {
        host: { select: { id: true, profile: { select: { name: true } } } },
        _count: { select: { bookings: true } },
      },
    });
  }

  /** Opens a Stripe Checkout Session for the access fee — mirrors AcademyService.initiatePurchase. */
  async bookSession(userId: string, sessionId: string) {
    const session = await this.prisma.liveMastermindSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.hostId === userId) {
      throw new BadRequestException('You cannot book your own session');
    }
    if (session.scheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('This session has already happened');
    }

    const existingBooking = await this.prisma.mastermindBooking.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
    });
    if (existingBooking) {
      throw new BadRequestException('You already booked this session');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const stripeCustomerId = await this.ensureStripeCustomer(userId, user.email);
    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';

    const checkout = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: session.currency.toLowerCase(),
            unit_amount: Math.round(Number(session.accessFee) * 100),
            product_data: { name: `Mastermind: ${session.title}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/mastermind/booking-success`,
      cancel_url: `${appUrl}/mastermind/booking-cancel`,
      metadata: {
        kind: 'mastermind_booking',
        userId,
        sessionId,
        hostId: session.hostId,
        currency: session.currency,
      },
    });

    return { checkoutUrl: checkout.url };
  }

  /** Called by StripeWebhookService once `checkout.session.completed` confirms real payment. */
  async completeBooking(checkoutSession: Stripe.Checkout.Session): Promise<void> {
    const { userId, sessionId, hostId } = checkoutSession.metadata ?? {};
    if (!userId || !sessionId || !hostId) {
      this.logger.warn(`checkout.session.completed for mastermind booking missing metadata (session ${checkoutSession.id})`);
      return;
    }

    const existing = await this.prisma.mastermindBooking.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
    });
    if (existing) {
      this.logger.debug(`Booking already exists for user ${userId}/session ${sessionId} — ignoring duplicate webhook`);
      return;
    }

    const session = await this.prisma.liveMastermindSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      this.logger.error(`checkout.session.completed for unknown mastermind session ${sessionId}`);
      return;
    }

    const amountPaid = (checkoutSession.amount_total ?? 0) / 100;
    const hostShare = Number((amountPaid * (1 - PLATFORM_TAKE_RATE)).toFixed(2));

    await this.prisma.$transaction([
      this.prisma.mastermindBooking.create({
        data: { sessionId, userId, pricePaid: new Prisma.Decimal(amountPaid), currency: session.currency },
      }),
      this.prisma.walletTransaction.create({
        data: {
          userId: hostId,
          type: WalletTransactionType.MASTERMIND_REVENUE,
          amount: new Prisma.Decimal(hostShare),
          currency: session.currency,
          metadata: { sessionId, checkoutSessionId: checkoutSession.id, grossAmount: amountPaid },
        },
      }),
      this.prisma.user.update({
        where: { id: hostId },
        data: { walletBalance: { increment: new Prisma.Decimal(hostShare) } },
      }),
    ]);

    const { stripeTransferId } = await this.connectService.payoutOrLedgerOnly(hostId, hostShare, session.currency, {
      kind: 'mastermind_revenue',
      sessionId,
      checkoutSessionId: checkoutSession.id,
    });

    this.logger.log(
      `Mastermind booking completed: user ${userId} booked ${sessionId}, host ${hostId} paid ${hostShare} ${session.currency}` +
        (stripeTransferId ? ` — real transfer ${stripeTransferId}` : ' — ledger only, Connect not onboarded'),
    );
  }

  /**
   * Gate for the actual stream link — host always has access; anyone else
   * needs a paid booking AND the session to be within its access window.
   */
  async getAccess(userId: string, sessionId: string) {
    const session = await this.prisma.liveMastermindSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const isHost = session.hostId === userId;
    if (!isHost) {
      const booking = await this.prisma.mastermindBooking.findUnique({
        where: { sessionId_userId: { sessionId, userId } },
      });
      if (!booking) {
        throw new ForbiddenException('You need to book this session before accessing it');
      }

      const opensAt = session.scheduledFor.getTime() - EARLY_ACCESS_WINDOW_MS;
      if (Date.now() < opensAt) {
        throw new ForbiddenException(`This session isn't open yet — it unlocks 15 minutes before ${session.scheduledFor.toISOString()}`);
      }
    }

    if (!session.liveStreamUrl) {
      throw new BadRequestException('The host has not published a stream link for this session yet');
    }

    return { title: session.title, scheduledFor: session.scheduledFor, liveStreamUrl: session.liveStreamUrl };
  }

  private async ensureStripeCustomer(userId: string, email: string): Promise<string> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;

    const customer = await this.stripe.customers.create({ email, metadata: { userId } });
    await this.prisma.subscription.upsert({
      where: { userId },
      update: { stripeCustomerId: customer.id },
      create: { userId, stripeCustomerId: customer.id },
    });
    return customer.id;
  }
}
