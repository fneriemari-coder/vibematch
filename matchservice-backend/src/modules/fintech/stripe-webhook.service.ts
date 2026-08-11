import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  EscrowStatus,
  InstallmentStatus,
  Prisma,
  SubscriptionStatus,
  SubscriptionTier,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AcademyService } from '../academy/academy.service';
import { MastermindService } from '../mastermind/mastermind.service';
import { CommunitiesService } from '../communities/communities.service';
import { ConnectService } from './connect.service';

/**
 * Handles international, multi-currency subscription billing:
 *   - US clients/providers: USD plans (Premium Client $49/mo, Pro Provider $49/mo equivalent tier)
 *   - BR clients/providers: BRL plans (R$149/mo)
 * The actual amount/currency lives in the Stripe Price object; this service
 * only needs to map "which Price was paid" -> "which SubscriptionTier to grant".
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly priceTierMap: Map<string, SubscriptionTier>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly academyService: AcademyService,
    private readonly mastermindService: MastermindService,
    private readonly communitiesService: CommunitiesService,
    private readonly connectService: ConnectService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
    this.webhookSecret = this.config.get('STRIPE_WEBHOOK_SECRET') ?? '';

    this.priceTierMap = new Map<string, SubscriptionTier>();
    const premiumUsd = this.config.get('STRIPE_PRICE_PREMIUM_CLIENT_USD');
    const premiumBrl = this.config.get('STRIPE_PRICE_PREMIUM_CLIENT_BRL');
    const proUsd = this.config.get('STRIPE_PRICE_PRO_PROVIDER_USD');
    const proBrl = this.config.get('STRIPE_PRICE_PRO_PROVIDER_BRL');
    if (premiumUsd) this.priceTierMap.set(premiumUsd, SubscriptionTier.PREMIUM_CLIENT);
    if (premiumBrl) this.priceTierMap.set(premiumBrl, SubscriptionTier.PREMIUM_CLIENT);
    if (proUsd) this.priceTierMap.set(proUsd, SubscriptionTier.PRO_PROVIDER);
    if (proBrl) this.priceTierMap.set(proBrl, SubscriptionTier.PRO_PROVIDER);
  }

  async handleEvent(rawBody: Buffer, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      this.logger.warn(`Stripe signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    // Event-level replay guard. Stripe retries aggressively and re-delivers on
    // its own schedule; before this, a replayed `invoice.paid` wrote a second
    // revenue row, incremented a wallet again and fired ANOTHER real Transfer.
    // Claiming the event id up front means only one delivery ever reaches the
    // handlers, and the primary key does the arbitration even under concurrent
    // duplicate deliveries.
    //
    // The read is only a fast path to keep the common replay quiet (Prisma
    // logs every constraint violation at error level); the primary key on the
    // create below is the actual arbiter, including for concurrent deliveries
    // that both get past this read.
    const seen = await this.prisma.processedStripeEvent.findUnique({ where: { id: event.id } });
    if (seen) {
      this.logger.log(
        `Stripe event ${event.id} (${event.type}) already processed at ${seen.processedAt.toISOString()} — ignoring replay`,
      );
      return { received: true, duplicate: true };
    }

    try {
      await this.prisma.processedStripeEvent.create({
        data: { id: event.id, type: event.type },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Stripe event ${event.id} (${event.type}) already processed — ignoring replay`);
        return { received: true, duplicate: true };
      }
      throw err;
    }

    try {
      await this.dispatch(event);
    } catch (err) {
      // Release the claim so Stripe's own retry can genuinely re-run this
      // event — a half-processed event that stayed "claimed" would be lost.
      await this.prisma.processedStripeEvent
        .delete({ where: { id: event.id } })
        .catch(() => undefined);
      throw err;
    }

    return { received: true };
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'identity.verification_session.verified':
        await this.handleIdentityVerified(event.data.object as Stripe.Identity.VerificationSession);
        break;
      // Pix and boleto settle asynchronously: Stripe fires
      // `checkout.session.completed` immediately with
      // `payment_status: 'unpaid'`, and only later
      // `checkout.session.async_payment_succeeded` once the money actually
      // arrives. Without the second case EVERY Pix/boleto payment in Brazil
      // was silently dropped — the customer paid and nothing happened. Both
      // route to the same handler; the `payment_status === 'paid'` check
      // inside it is what distinguishes them.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.async_payment_failed':
        await this.handleCheckoutSessionAsyncPaymentFailed(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'account.updated':
        await this.connectService.syncAccountStatus(event.data.object as Stripe.Account);
        break;
      default:
        this.logger.debug(`Ignoring unhandled Stripe event type: ${event.type}`);
    }
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    // BNPL installments are one-off invoices (no `invoice.subscription`) —
    // check first, since bnpl-installment-charger.service.ts may have left
    // this one SCHEDULED pending exactly this confirmation (async payment
    // method, e.g. 3DS).
    const bnplInstallment = await this.prisma.bnplInstallment.findFirst({ where: { stripeInvoiceId: invoice.id } });
    if (bnplInstallment) {
      await this.handleBnplInstallmentPaid(bnplInstallment.id, invoice);
      return;
    }

    // A client can simultaneously hold an app Subscription (Premium/Pro tier)
    // AND one or more MaintenanceAgreement subscriptions on the SAME Stripe
    // customer — check maintenance first, or a maintenance payment would be
    // misread as a tier renewal below.
    const stripeSubscriptionId =
      typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (stripeSubscriptionId) {
      const agreement = await this.prisma.maintenanceAgreement.findFirst({
        where: { stripeSubscriptionId },
      });
      if (agreement) {
        await this.handleMaintenanceInvoicePaid(agreement.id, invoice);
        return;
      }
    }

    const priceId = invoice.lines.data[0]?.price?.id;
    const tier = priceId ? this.priceTierMap.get(priceId) : undefined;

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!subscription) {
      this.logger.warn(`invoice.paid for unknown Stripe customer ${customerId}`);
      return;
    }

    // ABSOLUTE, not incremental. This used to be `currentExpiry + 30 days`,
    // so every replay of the same `invoice.paid` event handed the subscriber
    // another free month. Stripe tells us exactly which period was paid for —
    // deriving the expiry from the invoice's own billing period makes the
    // handler naturally idempotent: replaying it computes the same instant
    // and writes the same value.
    //
    // The `Date.now() + 30d` fallback is only for invoices with no period
    // (shouldn't happen for subscription invoices); it is absolute too, so a
    // replay still can't stack months.
    const periodEnd = invoice.lines.data[0]?.period?.end ?? invoice.period_end;
    const newExpiry = periodEnd
      ? new Date(periodEnd * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        tier: tier ?? subscription.tier,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: newExpiry,
      },
    });

    this.logger.log(`Subscription ${subscription.id} renewed -> ${tier ?? subscription.tier}, expires ${newExpiry.toISOString()}`);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    const bnplInstallment = await this.prisma.bnplInstallment.findFirst({ where: { stripeInvoiceId: invoice.id } });
    if (bnplInstallment) {
      const reason = invoice.last_finalization_error?.message ?? 'Payment failed (see Stripe dashboard for detail)';
      await this.prisma.bnplInstallment.update({
        where: { id: bnplInstallment.id },
        data: { status: InstallmentStatus.FAILED, failureReason: reason },
      });
      this.logger.warn(`BNPL installment ${bnplInstallment.id} FAILED via webhook (invoice ${invoice.id}): ${reason}`);
      return;
    }

    // Same reasoning as handleInvoicePaid: a failed maintenance charge must
    // never downgrade the client's unrelated app-level Subscription tier.
    const stripeSubscriptionId =
      typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (stripeSubscriptionId) {
      const agreement = await this.prisma.maintenanceAgreement.findFirst({ where: { stripeSubscriptionId } });
      if (agreement) {
        this.logger.warn(`Maintenance invoice payment failed for agreement ${agreement.id} (invoice ${invoice.id})`);
        return;
      }
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { tier: SubscriptionTier.FREE, status: SubscriptionStatus.PAST_DUE },
    });

    this.logger.log(`Subscription ${subscription.id} downgraded to FREE after failed payment`);
  }

  /** Idempotent — a webhook retry or a duplicate event must never double-mark this. */
  private async handleBnplInstallmentPaid(installmentId: string, invoice: Stripe.Invoice) {
    const installment = await this.prisma.bnplInstallment.findUnique({ where: { id: installmentId } });
    if (!installment || installment.status === InstallmentStatus.CHARGED) return;

    await this.prisma.bnplInstallment.update({
      where: { id: installmentId },
      data: { status: InstallmentStatus.CHARGED, chargedAt: new Date() },
    });
    this.logger.log(`BNPL installment ${installmentId} confirmed CHARGED via webhook (invoice ${invoice.id})`);
  }

  /**
   * A recurring maintenance invoice cleared — split it: platform keeps
   * `platformTakeRate` (15% by default, for cloud infra + AI monitoring),
   * the rest is credited to the provider's wallet as recurring revenue. The
   * platform's cut is intentionally NOT written as a WalletTransaction —
   * there's no "platform user" account to attribute it to — it's simply the
   * portion of `amount_paid` never forwarded; it's still fully reconstructable
   * from (invoice total - provider's MAINTENANCE_REVENUE row) for accounting.
   */
  private async handleMaintenanceInvoicePaid(agreementId: string, invoice: Stripe.Invoice) {
    const agreement = await this.prisma.maintenanceAgreement.findUnique({ where: { id: agreementId } });
    if (!agreement) return;

    // Idempotency guard. This handler had none: a replayed `invoice.paid`
    // wrote a SECOND revenue row, incremented the wallet again AND fired
    // another real Stripe Transfer. There is no ProcessedStripeEvent table to
    // dedupe on (adding one is the recommended follow-up), so the ledger row
    // this handler itself writes — which already carries `invoiceId` in its
    // metadata — is used as the marker.
    const alreadyCredited = await this.prisma.walletTransaction.findFirst({
      where: {
        userId: agreement.providerId,
        type: WalletTransactionType.MAINTENANCE_REVENUE,
        metadata: { path: ['invoiceId'], equals: invoice.id },
      },
      select: { id: true },
    });
    if (alreadyCredited) {
      this.logger.debug(
        `Maintenance invoice ${invoice.id} already credited (wallet transaction ${alreadyCredited.id}) — ignoring replay`,
      );
      return;
    }

    const amountPaid = invoice.amount_paid / 100;
    const providerShare = Number((amountPaid * (1 - agreement.platformTakeRate)).toFixed(2));
    const platformShare = Number((amountPaid - providerShare).toFixed(2));

    await this.prisma.$transaction([
      this.prisma.walletTransaction.create({
        data: {
          userId: agreement.providerId,
          type: WalletTransactionType.MAINTENANCE_REVENUE,
          amount: new Prisma.Decimal(providerShare),
          currency: agreement.currency,
          metadata: {
            agreementId: agreement.id,
            invoiceId: invoice.id,
            grossAmount: amountPaid,
            platformTakeRate: agreement.platformTakeRate,
            platformShare,
          },
        },
      }),
      this.prisma.user.update({
        where: { id: agreement.providerId },
        data: { walletBalance: { increment: new Prisma.Decimal(providerShare) } },
      }),
    ]);

    const { stripeTransferId } = await this.connectService.payoutOrLedgerOnly(
      agreement.providerId,
      providerShare,
      agreement.currency,
      { kind: 'maintenance_revenue', agreementId: agreement.id, invoiceId: invoice.id },
    );

    this.logger.log(
      `Maintenance invoice ${invoice.id} paid for agreement ${agreement.id}: ` +
        `${providerShare} ${agreement.currency} to provider ${agreement.providerId}, ` +
        `${platformShare} ${agreement.currency} platform take (${(agreement.platformTakeRate * 100).toFixed(0)}%)` +
        (stripeTransferId ? ` — real transfer ${stripeTransferId}` : ' — ledger only, Connect not onboarded'),
    );
  }

  /**
   * Routes completed Checkout Sessions by `metadata.kind`.
   *
   * Two shapes land here:
   *  - `mode: 'payment'` one-offs (course purchase, mastermind booking),
   *    which must additionally be `payment_status: 'paid'`;
   *  - `mode: 'subscription'` community memberships, whose first invoice is
   *    settled as part of the session, so the seat opens here rather than
   *    waiting for a separate `invoice.paid`.
   *
   * App subscription tiers and maintenance contracts are deliberately NOT
   * handled here — they're matched on the Stripe customer in
   * `invoice.paid`, and they carry no session metadata to route on.
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const kind = session.metadata?.kind;

    if (session.mode === 'subscription') {
      if (kind === 'community_membership') {
        await this.communitiesService.completeMembership(session);
        return;
      }
      this.logger.warn(
        `Dropping subscription Checkout Session ${session.id}: unrecognized metadata.kind ` +
          `${kind ?? '(none)'} — no handler claims it, nothing was granted`,
      );
      return;
    }

    if (session.mode !== 'payment') {
      this.logger.warn(
        `Dropping Checkout Session ${session.id}: unsupported mode ${session.mode ?? '(none)'} ` +
          `(kind ${kind ?? '(none)'})`,
      );
      return;
    }

    if (session.payment_status !== 'paid') {
      // Expected for Pix/boleto on the SYNCHRONOUS `checkout.session.completed`
      // event — `checkout.session.async_payment_succeeded` will follow when the
      // money lands and re-enter this handler. Logged rather than dropped in
      // silence so an async payment that never settles is visible.
      this.logger.warn(
        `Checkout Session ${session.id} (kind ${kind ?? '(none)'}) not fulfilled yet: ` +
          `payment_status=${session.payment_status} — awaiting ` +
          'checkout.session.async_payment_succeeded (Pix/boleto) or expiry',
      );
      return;
    }

    if (kind === 'course_purchase') {
      await this.academyService.completePurchase(session);
      return;
    }

    if (kind === 'mastermind_booking') {
      await this.mastermindService.completeBooking(session);
      return;
    }

    if (kind === 'escrow_funding') {
      await this.handleEscrowFundingPaid(session);
      return;
    }

    this.logger.warn(
      `Dropping paid Checkout Session ${session.id}: unrecognized metadata.kind ${kind ?? '(none)'} — ` +
        'money was taken and no handler claims it',
    );
  }

  /**
   * The ONLY place an EscrowProject becomes FUNDED through the client-funding
   * path. `EscrowService.fund()` opens a Checkout Session and returns its URL;
   * it no longer flips the status itself, so no money-free funding is possible.
   *
   * Idempotent by construction: the conditional `updateMany` only matches a
   * project still in PENDING, so a replayed event (or the
   * completed/async_payment_succeeded pair for the same session) matches zero
   * rows and returns early without a second write. The DEPOSIT ledger row is
   * likewise guarded on the session id.
   */
  private async handleEscrowFundingPaid(session: Stripe.Checkout.Session): Promise<void> {
    const { escrowProjectId, clientId } = session.metadata ?? {};
    if (!escrowProjectId || !clientId) {
      this.logger.warn(
        `checkout.session.completed for escrow funding missing metadata (session ${session.id})`,
      );
      return;
    }

    const project = await this.prisma.escrowProject.findUnique({ where: { id: escrowProjectId } });
    if (!project) {
      this.logger.error(
        `Escrow funding paid for unknown project ${escrowProjectId} (session ${session.id})`,
      );
      return;
    }
    if (project.status !== EscrowStatus.PENDING) {
      this.logger.debug(
        `Escrow ${escrowProjectId} already in status ${project.status} — ignoring duplicate funding webhook (session ${session.id})`,
      );
      return;
    }

    const amountPaid = (session.amount_total ?? 0) / 100;
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    // Conditional update: only a project still PENDING matches, so a replayed
    // event (or the completed / async_payment_succeeded pair for the same
    // session) matches zero rows. The PaymentIntent is persisted here — this
    // is what makes EscrowService.refund a lookup rather than a Stripe search.
    const funded = await this.prisma.escrowProject.updateMany({
      where: { id: escrowProjectId, status: EscrowStatus.PENDING },
      data: { status: EscrowStatus.FUNDED, fundedAt: new Date(), stripePaymentIntentId: paymentIntentId },
    });
    if (funded.count === 0) {
      this.logger.debug(
        `Escrow ${escrowProjectId} was funded concurrently — ignoring duplicate webhook (session ${session.id})`,
      );
      return;
    }

    // The client's deposit, recorded as a negative (debit) ledger row against
    // the project. `walletBalance` is intentionally NOT touched — the money
    // came from a card/Pix, not from the client's in-app wallet. This is the
    // audit trail for the charge, and a second place the PaymentIntent can be
    // recovered from for projects funded before the column existed.
    await this.prisma.walletTransaction.create({
      data: {
        userId: clientId,
        type: WalletTransactionType.DEPOSIT,
        amount: new Prisma.Decimal(-amountPaid),
        currency: project.currency,
        relatedEscrowId: escrowProjectId,
        metadata: {
          kind: 'escrow_funding',
          checkoutSessionId: session.id,
          paymentIntentId,
          grossAmount: amountPaid,
        },
      },
    });

    this.logger.log(
      `Escrow ${escrowProjectId} FUNDED by client ${clientId}: ${amountPaid} ${project.currency} ` +
        `(session ${session.id}, payment intent ${paymentIntentId ?? 'unknown'})`,
    );
  }

  /** Pix/boleto that never settled — the seat/project must stay unfunded. */
  private async handleCheckoutSessionAsyncPaymentFailed(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    this.logger.warn(
      `Async payment FAILED for Checkout Session ${session.id} (kind ${session.metadata?.kind ?? '(none)'}, ` +
        `payment_status=${session.payment_status}) — nothing granted, customer must retry`,
    );
  }

  /**
   * The only place `User.identityVerified` is ever set to true — deliberately
   * never settable directly from a client-facing route, since AntiFraudGuard
   * treats it as proof of a completed Stripe Identity check.
   */
  private async handleIdentityVerified(session: Stripe.Identity.VerificationSession) {
    const userId = session.metadata?.userId;
    if (!userId) {
      this.logger.warn(`identity.verification_session.verified with no userId in metadata (session ${session.id})`);
      return;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { identityVerified: true },
    });

    this.logger.log(`Identity verified for user ${userId} (Stripe session ${session.id})`);
  }
}
