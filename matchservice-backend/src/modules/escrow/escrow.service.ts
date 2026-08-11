import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  EscrowStatus,
  MatchType,
  MilestoneStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScoreEngine } from '../users/score.engine';
import { MaintenanceService } from '../fintech/maintenance.service';
import { ConnectService } from '../fintech/connect.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';

/**
 * Platform share of every escrow release, read from
 * `PLATFORM_ESCROW_TAKE_RATE`. Default 0.03 (3%) — deliberately the same key
 * and default AdminAnalyticsService already uses to project "nominal" escrow
 * revenue, so the projection and the money actually kept now agree.
 *
 * The provider's share is what gets rounded; the platform absorbs the
 * remainder (`budget - providerShare`), so provider + platform always sum to
 * the budget exactly and no cent is lost — same convention as the 80/20
 * course split in AcademyService.completePurchase.
 */
const DEFAULT_PLATFORM_ESCROW_TAKE_RATE = 0.03;

/**
 * Wallet transaction types that represent money already handed to the
 * provider against a specific escrow project *before* the final release:
 * a receivables advance (FintechService.advance), an upfront BNPL payout
 * (BnplService.financeProject) and AI-verified milestone releases
 * (AiValidatorService). `complete()` nets these off the provider's share so
 * a project that was advanced/financed/partially released can't be paid for
 * twice.
 */
const PRIOR_RELEASE_TYPES: WalletTransactionType[] = [
  WalletTransactionType.ADVANCE,
  WalletTransactionType.BNPL_FUNDING,
  WalletTransactionType.MILESTONE_RELEASE,
  WalletTransactionType.ESCROW_RELEASE,
];

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);
  private readonly stripe: Stripe;
  private readonly platformTakeRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scoreEngine: ScoreEngine,
    private readonly maintenanceService: MaintenanceService,
    private readonly connectService: ConnectService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
    const configured = Number(this.config.get('PLATFORM_ESCROW_TAKE_RATE'));
    this.platformTakeRate =
      Number.isFinite(configured) && configured >= 0 && configured < 1
        ? configured
        : DEFAULT_PLATFORM_ESCROW_TAKE_RATE;
  }

  /**
   * Opens an Escrow project for a SERVICE match. B2B matches only open a
   * partnership chat and must never generate an Escrow project — enforced here.
   */
  async create(requesterId: string, dto: CreateEscrowDto) {
    const match = await this.prisma.match.findUnique({ where: { id: dto.matchId } });
    if (!match) throw new NotFoundException('Match not found');

    if (match.type === MatchType.B2B) {
      throw new BadRequestException('B2B matches open a partnership chat only — no Escrow project');
    }

    const participants = [match.userOneId, match.userTwoId];
    if (!participants.includes(requesterId)) {
      throw new ForbiddenException('You are not a participant in this match');
    }
    if (dto.clientId === dto.providerId) {
      throw new BadRequestException('clientId and providerId must be different users');
    }
    const sameParticipants =
      participants.includes(dto.clientId) && participants.includes(dto.providerId);
    if (!sameParticipants) {
      throw new BadRequestException('clientId/providerId must be the two users of this match');
    }

    try {
      return await this.prisma.escrowProject.create({
        data: {
          matchId: dto.matchId,
          clientId: dto.clientId,
          providerId: dto.providerId,
          budget: new Prisma.Decimal(dto.budget),
          currency: dto.currency,
          status: EscrowStatus.PENDING,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('This match already has an Escrow project');
      }
      throw err;
    }
  }

  /**
   * Internal lookup — no authorization. Callers that serve a request must use
   * `findByIdForUser`; this one exists for the state transitions below, which
   * do their own participant checks.
   */
  async findById(id: string) {
    const project = await this.prisma.escrowProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Escrow project not found');
    return project;
  }

  /**
   * The authorized read. `GET /escrow/:id` previously called `findById`
   * directly, so any authenticated user could read any project's client,
   * provider, budget and status by guessing an id — the commercial terms of
   * other people's deals.
   */
  async findByIdForUser(id: string, userId: string) {
    const project = await this.findById(id);
    if (project.clientId !== userId && project.providerId !== userId) {
      throw new ForbiddenException('You are not a participant in this project');
    }
    return project;
  }

  /**
   * The caller's projects, newest first.
   *
   * Returns the counterpart's name and the milestone tally alongside each
   * project. The bare rows this used to return were unrenderable — a list of
   * uuids and amounts with no indication of who the deal is with or how far
   * along it is — and resolving that client-side would have meant one request
   * per project.
   */
  async listForUser(userId: string) {
    const projects = await this.prisma.escrowProject.findMany({
      where: { OR: [{ clientId: userId }, { providerId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, profile: { select: { name: true } } } },
        provider: { select: { id: true, profile: { select: { name: true } } } },
        milestones: { select: { status: true } },
      },
    });

    return projects.map((project) => {
      const isClient = project.clientId === userId;
      const counterpart = isClient ? project.provider : project.client;
      return {
        id: project.id,
        matchId: project.matchId,
        status: project.status,
        budget: project.budget,
        currency: project.currency,
        paymentModel: project.paymentModel,
        installmentCount: project.installmentCount,
        advanced: project.advanced,
        role: isClient ? 'CLIENT' : 'PROVIDER',
        counterpartId: counterpart.id,
        counterpartName: counterpart.profile?.name ?? 'Usuário',
        milestoneTotal: project.milestones.length,
        milestoneApproved: project.milestones.filter((m) => m.status === MilestoneStatus.APPROVED)
          .length,
        createdAt: project.createdAt,
        fundedAt: project.fundedAt,
        completedAt: project.completedAt,
        disputedAt: project.disputedAt,
      };
    });
  }

  /**
   * Client deposits funds — only from PENDING.
   *
   * This opens a REAL Stripe Checkout Session for the project budget and
   * returns its URL; it deliberately does NOT flip the project to FUNDED.
   * Until this change `fund()` set `status = FUNDED` on its own with no
   * PaymentIntent and no charge, which meant a client could self-declare any
   * budget, "fund" it for free, and the provider could then advance/withdraw
   * real money against it (see FintechService.advance ->
   * ConnectService.payoutOrLedgerOnly, which issues a real Stripe Transfer).
   *
   * The PENDING -> FUNDED transition now happens exactly once, from
   * `checkout.session.completed` / `checkout.session.async_payment_succeeded`
   * in StripeWebhookService.handleEscrowFundingPaid.
   *
   * Mirrors AcademyService.initiatePurchase: same customer resolution, same
   * `appUrl` success/cancel convention, inline `price_data` (there is no
   * preconfigured Price for a per-project budget).
   */
  async fund(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (project.clientId !== userId) {
      throw new ForbiddenException('Only the client can fund this project');
    }
    if (project.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(`Cannot fund a project in status ${project.status}`);
    }

    const budget = Number(project.budget);
    if (!(budget > 0)) {
      throw new BadRequestException('Cannot fund a project with a non-positive budget');
    }

    const client = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const stripeCustomerId = await this.ensureStripeCustomer(userId, client.email);
    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';

    const metadata = {
      kind: 'escrow_funding',
      escrowProjectId: project.id,
      clientId: project.clientId,
      providerId: project.providerId,
    };

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: project.currency.toLowerCase(),
            unit_amount: Math.round(budget * 100),
            product_data: { name: `Depósito em garantia — projeto ${project.id}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/escrow/fund-success`,
      cancel_url: `${appUrl}/escrow/fund-cancel`,
      metadata,
      // Copied onto the PaymentIntent as well. EscrowProject has no
      // `stripePaymentIntentId` column (see the class-level note on
      // `refund()`), so this is what makes the charge findable later via
      // `paymentIntents.search` when the ledger lookup can't resolve it.
      payment_intent_data: { metadata },
    });

    this.logger.log(
      `Checkout session ${session.id} created to fund escrow ${project.id} — ` +
        `${budget} ${project.currency} from client ${userId}`,
    );

    return {
      checkoutUrl: session.url,
      escrowId: project.id,
      amount: budget,
      currency: project.currency,
      // Unchanged until Stripe confirms the payment — the client is expected
      // to poll GET /escrow/:id (or be pushed to) after returning from Checkout.
      status: project.status,
    };
  }

  /**
   * Client confirms delivery and releases escrowed funds to the provider.
   *
   * Before this change `complete()` only flipped the status and recalculated
   * the score — `WalletTransactionType.ESCROW_RELEASE` was declared in the
   * schema and written nowhere, so a provider was never paid on a normal
   * completion. It now writes the ledger row, credits `walletBalance` and
   * sets COMPLETED in ONE `$transaction`, then attempts a real Stripe
   * Transfer outside it — exactly the "ledger first, optional real transfer
   * after" shape of AcademyService.completePurchase.
   *
   * Only a FUNDED project can complete: a PENDING one has no money behind it.
   */
  async complete(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (project.clientId !== userId) {
      throw new ForbiddenException('Only the client can release funds for this project');
    }
    if (project.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Cannot complete a project in status ${project.status}`);
    }

    const grossBudget = Number(project.budget);
    // Round the provider's share, let the platform absorb the remainder —
    // provider + platform is always exactly the budget.
    const providerShareTarget = Number((grossBudget * (1 - this.platformTakeRate)).toFixed(2));
    const platformShare = Number((grossBudget - providerShareTarget).toFixed(2));

    // Anything already paid to this provider against this project (advance,
    // BNPL upfront payout, AI-verified milestone releases) is netted off, so
    // completion tops the provider up to their share instead of paying the
    // whole budget a second time.
    const priorAgg = await this.prisma.walletTransaction.aggregate({
      where: {
        relatedEscrowId: escrowId,
        userId: project.providerId,
        type: { in: PRIOR_RELEASE_TYPES },
      },
      _sum: { amount: true },
    });
    const alreadyReleased = Number(priorAgg._sum.amount ?? 0);
    const releaseAmount = Number(Math.max(0, providerShareTarget - alreadyReleased).toFixed(2));

    const completionData = {
      status: EscrowStatus.COMPLETED,
      completedAt: new Date(),
    };

    let updated;
    if (releaseAmount > 0) {
      const [, , completed] = await this.prisma.$transaction([
        this.prisma.walletTransaction.create({
          data: {
            userId: project.providerId,
            type: WalletTransactionType.ESCROW_RELEASE,
            amount: new Prisma.Decimal(releaseAmount),
            currency: project.currency,
            relatedEscrowId: escrowId,
            metadata: {
              kind: 'escrow_release',
              escrowProjectId: escrowId,
              grossBudget,
              platformTakeRate: this.platformTakeRate,
              platformShare,
              providerShareTarget,
              alreadyReleased,
            },
          },
        }),
        this.prisma.user.update({
          where: { id: project.providerId },
          data: { walletBalance: { increment: new Prisma.Decimal(releaseAmount) } },
        }),
        this.prisma.escrowProject.update({ where: { id: escrowId }, data: completionData }),
      ]);
      updated = completed;
    } else {
      this.logger.warn(
        `Escrow ${escrowId} completed with no new release: provider ${project.providerId} ` +
          `already received ${alreadyReleased} ${project.currency} against a share of ${providerShareTarget} ` +
          '(advanced / BNPL-financed / milestone-released)',
      );
      updated = await this.prisma.escrowProject.update({
        where: { id: escrowId },
        data: completionData,
      });
    }

    if (releaseAmount > 0) {
      // Ledger is already committed — this only ADDITIONALLY pushes real money
      // to an onboarded Connect account, and swallows its own failures.
      const { stripeTransferId } = await this.connectService.payoutOrLedgerOnly(
        project.providerId,
        releaseAmount,
        project.currency,
        { kind: 'escrow_release', escrowProjectId: escrowId },
      );

      this.logger.log(
        `Escrow ${escrowId} completed: ${releaseAmount} ${project.currency} released to provider ` +
          `${project.providerId} (gross ${grossBudget}, platform kept ${platformShare} at ` +
          `${(this.platformTakeRate * 100).toFixed(1)}%, already released ${alreadyReleased})` +
          (stripeTransferId ? ` — real transfer ${stripeTransferId}` : ' — ledger only, Connect not onboarded'),
      );
    }

    await this.scoreEngine.recalculate(project.providerId);

    // Best-effort upsell — see MaintenanceService.activateIfEligible for why
    // this never throws back into the completion flow.
    await this.maintenanceService.activateIfEligible(updated.id);

    return updated;
  }

  /** Either party opens a dispute on a funded project. */
  async dispute(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (![project.clientId, project.providerId].includes(userId)) {
      throw new ForbiddenException('You are not a participant in this project');
    }
    if (project.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Cannot dispute a project in status ${project.status}`);
    }
    const updated = await this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.DISPUTED, disputedAt: new Date() },
    });
    await this.scoreEngine.recalculate(project.providerId);
    return updated;
  }

  /** Client cancels before funding — no money has moved yet. */
  async cancel(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (project.clientId !== userId) {
      throw new ForbiddenException('Only the client can cancel this project');
    }
    if (project.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(`Cannot cancel a project in status ${project.status}`);
    }
    const updated = await this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.CANCELED },
    });
    await this.scoreEngine.recalculate(project.providerId);
    return updated;
  }

  /**
   * Refunds a funded, disputed project back to the client (dispute resolution).
   *
   * This now issues a REAL `stripe.refunds.create` against the PaymentIntent
   * that funded the project. It used to only flip the status, so a "refunded"
   * client was never actually given their money back.
   *
   * Money moves BEFORE the status flips: if Stripe rejects the refund the
   * project stays DISPUTED, which is the honest state.
   */
  async refund(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (![project.clientId, project.providerId].includes(userId)) {
      throw new ForbiddenException('You are not a participant in this project');
    }
    if (project.status !== EscrowStatus.DISPUTED) {
      throw new BadRequestException('Only disputed projects can be refunded');
    }

    const paymentIntentId = await this.resolveFundingPaymentIntentId(project);

    let refund: Stripe.Refund;
    try {
      refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        metadata: { kind: 'escrow_refund', escrowProjectId: escrowId, requestedBy: userId },
      });
    } catch (err) {
      this.logger.error(
        `Stripe refund failed for escrow ${escrowId} (payment intent ${paymentIntentId}) — ` +
          `project left DISPUTED: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        `Refund could not be issued at Stripe: ${(err as Error).message}`,
      );
    }

    const updated = await this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.REFUNDED },
    });
    await this.scoreEngine.recalculate(project.providerId);

    this.logger.log(
      `Escrow ${escrowId} refunded: Stripe refund ${refund.id} of ${(refund.amount ?? 0) / 100} ` +
        `${(refund.currency ?? project.currency).toUpperCase()} against payment intent ${paymentIntentId}`,
    );

    return { ...updated, stripeRefundId: refund.id };
  }

  /**
   * Recovers the PaymentIntent that funded a project, in decreasing order of
   * confidence:
   *
   *  1. `EscrowProject.stripePaymentIntentId`, written by the funding webhook.
   *     This is a plain lookup and covers every project funded through
   *     Checkout from here on.
   *  2. The DEPOSIT WalletTransaction's `paymentIntentId` metadata, then its
   *     `checkoutSessionId` re-retrieved from Stripe — belt and braces for a
   *     project funded in the window before the column existed.
   *  3. `paymentIntents.search` on the metadata `fund()` stamps onto
   *     `payment_intent_data`. This is the legacy/backfill path: Stripe's
   *     search index is eventually consistent (~1 min, fine here since a
   *     refund always follows funding by a long way) and it is a search, not
   *     a lookup, so it can legitimately return nothing.
   *
   * When all of these fail this throws rather than flipping the project to
   * REFUNDED without moving money.
   */
  private async resolveFundingPaymentIntentId(project: {
    id: string;
    stripePaymentIntentId: string | null;
  }): Promise<string> {
    if (project.stripePaymentIntentId) return project.stripePaymentIntentId;

    const escrowId = project.id;
    const depositTx = await this.prisma.walletTransaction.findFirst({
      where: { relatedEscrowId: escrowId, type: WalletTransactionType.DEPOSIT },
      orderBy: { createdAt: 'desc' },
    });
    const depositMetadata = (depositTx?.metadata ?? {}) as Record<string, unknown>;

    const storedIntentId = depositMetadata.paymentIntentId;
    if (typeof storedIntentId === 'string' && storedIntentId.length > 0) {
      return storedIntentId;
    }

    const storedSessionId = depositMetadata.checkoutSessionId;
    if (typeof storedSessionId === 'string' && storedSessionId.length > 0) {
      const session = await this.stripe.checkout.sessions.retrieve(storedSessionId);
      const fromSession =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
      if (fromSession) return fromSession;
    }

    this.logger.warn(
      `No stored PaymentIntent for escrow ${escrowId} (funded before the column existed, or never ` +
        'funded through Checkout) — falling back to Stripe metadata search',
    );

    const search = await this.stripe.paymentIntents.search({
      query: `metadata['escrowProjectId']:'${escrowId}' AND status:'succeeded'`,
      limit: 1,
    });
    const found = search.data[0]?.id;
    if (found) return found;

    throw new BadRequestException(
      `No Stripe payment found for escrow project ${escrowId} — it was never funded through Checkout, ` +
        'so there is nothing to refund. Refund manually in the Stripe dashboard if a charge exists.',
    );
  }

  /**
   * Same customer resolution AcademyService uses — Subscription is the only
   * row in this schema that carries a `stripeCustomerId`, so it doubles as
   * the customer registry for one-off payments.
   */
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
