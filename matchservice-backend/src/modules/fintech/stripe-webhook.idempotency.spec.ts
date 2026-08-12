import { Currency, EscrowStatus, Prisma, SubscriptionTier, WalletTransactionType } from '@prisma/client';
import { StripeWebhookService } from './stripe-webhook.service';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

function buildService(prisma: any, config = buildConfig()) {
  const academyService = { completePurchase: jest.fn() };
  const mastermindService = { completeBooking: jest.fn() };
  const communitiesService = { completeMembership: jest.fn() };
  // Only reached by the mentorship_booking branch, which these tests do not
  // exercise — present so the constructor arity matches.
  const mentorshipService = { completeBooking: jest.fn() };
  const connectService = { payoutOrLedgerOnly: jest.fn().mockResolvedValue({ stripeTransferId: 'tr_1' }) };
  const service = new StripeWebhookService(
    prisma,
    config as any,
    academyService as any,
    mastermindService as any,
    communitiesService as any,
    mentorshipService as any,
    connectService as any,
  );
  return { service, academyService, mastermindService, communitiesService, connectService };
}

describe('StripeWebhookService — maintenance invoice idempotency', () => {
  /**
   * The exact scenario the audit called out: Stripe re-delivers the same
   * `invoice.paid`. Before the guard this wrote a SECOND revenue row,
   * incremented the wallet again AND fired another real Transfer.
   */
  function buildMaintenancePrisma() {
    const walletRows: any[] = [];
    return {
      __rows: walletRows,
      maintenanceAgreement: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'agreement-1',
          providerId: 'provider-1',
          currency: Currency.BRL,
          platformTakeRate: 0.15,
        }),
      },
      walletTransaction: {
        // Mirrors the real Prisma JSON-path filter: "is there already a
        // MAINTENANCE_REVENUE row carrying this invoice id?"
        findFirst: jest.fn(async ({ where }: any) => {
          const invoiceId = where.metadata?.equals;
          return (
            walletRows.find(
              (r) => r.type === WalletTransactionType.MAINTENANCE_REVENUE && r.metadata?.invoiceId === invoiceId,
            ) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `tx-${walletRows.length + 1}`, ...data };
          walletRows.push(row);
          return row;
        }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    };
  }

  it('credits the provider exactly once when the same invoice.paid is delivered twice', async () => {
    const prisma = buildMaintenancePrisma();
    const { service, connectService } = buildService(prisma);
    const invoice: any = { id: 'in_replay', amount_paid: 20000 }; // R$200.00

    await (service as any).handleMaintenanceInvoicePaid('agreement-1', invoice);
    await (service as any).handleMaintenanceInvoicePaid('agreement-1', invoice);

    const revenueRows = prisma.__rows.filter(
      (r) => r.type === WalletTransactionType.MAINTENANCE_REVENUE,
    );
    expect(revenueRows).toHaveLength(1);
    expect(revenueRows[0].amount.toString()).toBe('170'); // 200 * 0.85

    // One wallet increment, one real Transfer — not two of each.
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(connectService.payoutOrLedgerOnly).toHaveBeenCalledTimes(1);
  });

  it('still credits a genuinely different invoice on the same agreement', async () => {
    const prisma = buildMaintenancePrisma();
    const { service, connectService } = buildService(prisma);

    await (service as any).handleMaintenanceInvoicePaid('agreement-1', { id: 'in_jan', amount_paid: 20000 });
    await (service as any).handleMaintenanceInvoicePaid('agreement-1', { id: 'in_feb', amount_paid: 20000 });

    expect(prisma.__rows).toHaveLength(2);
    expect(connectService.payoutOrLedgerOnly).toHaveBeenCalledTimes(2);
  });
});

describe('StripeWebhookService — escrow funding idempotency', () => {
  function buildEscrowPrisma(initialStatus: EscrowStatus = EscrowStatus.PENDING) {
    const state = {
      status: initialStatus as EscrowStatus,
      fundedAt: null as Date | null,
      stripePaymentIntentId: null as string | null,
    };
    const walletRows: any[] = [];
    return {
      __state: state,
      __rows: walletRows,
      escrowProject: {
        findUnique: jest.fn(async () => ({
          id: 'project-1',
          clientId: 'client-1',
          providerId: 'provider-1',
          currency: Currency.BRL,
          budget: 1000,
          ...state,
        })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (state.status !== where.status) return { count: 0 };
          state.status = data.status;
          state.fundedAt = data.fundedAt;
          state.stripePaymentIntentId = data.stripePaymentIntentId;
          return { count: 1 };
        }),
      },
      walletTransaction: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `tx-${walletRows.length + 1}`, ...data };
          walletRows.push(row);
          return row;
        }),
      },
    };
  }

  const fundingSession: any = {
    id: 'cs_escrow_1',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 100000, // R$1000.00
    payment_intent: 'pi_escrow_1',
    metadata: {
      kind: 'escrow_funding',
      escrowProjectId: 'project-1',
      clientId: 'client-1',
      providerId: 'provider-1',
    },
  };

  it('transitions PENDING -> FUNDED and records the PaymentIntent for a later refund', async () => {
    const prisma = buildEscrowPrisma();
    const { service } = buildService(prisma);

    await (service as any).handleCheckoutSessionCompleted(fundingSession);

    expect(prisma.__state.status).toBe(EscrowStatus.FUNDED);
    expect(prisma.__state.fundedAt).toBeInstanceOf(Date);
    // Persisted on the project itself — this is what makes refund() a lookup.
    expect(prisma.__state.stripePaymentIntentId).toBe('pi_escrow_1');

    const deposit = prisma.__rows[0];
    expect(deposit.type).toBe(WalletTransactionType.DEPOSIT);
    expect(deposit.userId).toBe('client-1');
    expect(deposit.relatedEscrowId).toBe('project-1');
    expect(Number(deposit.amount)).toBe(-1000); // debit: money left the client
    expect(deposit.metadata.paymentIntentId).toBe('pi_escrow_1');
    expect(deposit.metadata.checkoutSessionId).toBe('cs_escrow_1');
  });

  it('is idempotent — the same event delivered twice funds the project once', async () => {
    const prisma = buildEscrowPrisma();
    const { service } = buildService(prisma);

    await (service as any).handleCheckoutSessionCompleted(fundingSession);
    const fundedAtAfterFirst = prisma.__state.fundedAt;
    await (service as any).handleCheckoutSessionCompleted(fundingSession);

    expect(prisma.escrowProject.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.__rows).toHaveLength(1);
    expect(prisma.__state.fundedAt).toBe(fundedAtAfterFirst);
  });

  it('is idempotent across the completed / async_payment_succeeded pair', async () => {
    const prisma = buildEscrowPrisma();
    const { service } = buildService(prisma);

    // Pix: first the synchronous unpaid event, then the async success.
    await (service as any).handleCheckoutSessionCompleted({
      ...fundingSession,
      payment_status: 'unpaid',
    });
    expect(prisma.__state.status).toBe(EscrowStatus.PENDING);
    expect(prisma.__rows).toHaveLength(0);

    await (service as any).handleCheckoutSessionCompleted(fundingSession);
    expect(prisma.__state.status).toBe(EscrowStatus.FUNDED);

    // A duplicate delivery of the success event changes nothing.
    await (service as any).handleCheckoutSessionCompleted(fundingSession);
    expect(prisma.__rows).toHaveLength(1);
  });

  it('returns early without a second write when the project is already FUNDED', async () => {
    const prisma = buildEscrowPrisma(EscrowStatus.FUNDED);
    const { service } = buildService(prisma);

    await (service as any).handleCheckoutSessionCompleted(fundingSession);

    expect(prisma.escrowProject.updateMany).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });
});

/**
 * Models the ProcessedStripeEvent primary key: a second `create` with the same
 * event id raises P2002, exactly as Postgres would.
 */
function buildProcessedEventStore() {
  const seen = new Set<string>();
  return {
    __seen: seen,
    findUnique: jest.fn(async ({ where }: any) =>
      seen.has(where.id) ? { id: where.id, type: 'x', processedAt: new Date() } : null,
    ),
    create: jest.fn(async ({ data }: any) => {
      if (seen.has(data.id)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        });
      }
      seen.add(data.id);
      return data;
    }),
    delete: jest.fn(async ({ where }: any) => {
      seen.delete(where.id);
      return {};
    }),
  };
}

describe('StripeWebhookService — event-level replay guard', () => {
  it('runs the handlers once and short-circuits every redelivery of the same event id', async () => {
    const processedStripeEvent = buildProcessedEventStore();
    const { service, academyService } = buildService({ processedStripeEvent } as any);
    (service as any).stripe = {
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          id: 'evt_replay_1',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_1',
              mode: 'payment',
              payment_status: 'paid',
              metadata: { kind: 'course_purchase' },
            },
          },
        }),
      },
    };

    const first = await service.handleEvent(Buffer.from('{}'), 'sig');
    const second = await service.handleEvent(Buffer.from('{}'), 'sig');
    const third = await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(academyService.completePurchase).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ received: true });
    expect(second).toEqual({ received: true, duplicate: true });
    expect(third).toEqual({ received: true, duplicate: true });
  });

  it('releases the claim when a handler throws, so Stripe\'s retry can re-run it', async () => {
    const processedStripeEvent = buildProcessedEventStore();
    const { service, academyService } = buildService({ processedStripeEvent } as any);
    academyService.completePurchase
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);
    (service as any).stripe = {
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          id: 'evt_retry_1',
          type: 'checkout.session.completed',
          data: {
            object: { id: 'cs_2', mode: 'payment', payment_status: 'paid', metadata: { kind: 'course_purchase' } },
          },
        }),
      },
    };

    await expect(service.handleEvent(Buffer.from('{}'), 'sig')).rejects.toThrow('database unavailable');
    expect(processedStripeEvent.delete).toHaveBeenCalledWith({ where: { id: 'evt_retry_1' } });
    expect(processedStripeEvent.__seen.has('evt_retry_1')).toBe(false);

    // Stripe retries — this time it succeeds and is marked processed.
    await expect(service.handleEvent(Buffer.from('{}'), 'sig')).resolves.toEqual({ received: true });
    expect(academyService.completePurchase).toHaveBeenCalledTimes(2);
  });
});

describe('StripeWebhookService — Pix / boleto routing', () => {
  it('routes checkout.session.async_payment_succeeded to the same handlers as the sync path', async () => {
    const prisma: any = { processedStripeEvent: buildProcessedEventStore() };
    const { service, academyService } = buildService(prisma);
    const constructEvent = jest.fn().mockReturnValue({
      id: 'evt_pix_1',
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: {
          id: 'cs_pix_1',
          mode: 'payment',
          payment_status: 'paid',
          metadata: { kind: 'course_purchase' },
        },
      },
    });
    (service as any).stripe = { webhooks: { constructEvent } };

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(academyService.completePurchase).toHaveBeenCalledTimes(1);
  });

  it('handles checkout.session.async_payment_failed without granting anything', async () => {
    const prisma: any = { processedStripeEvent: buildProcessedEventStore() };
    const { service, academyService } = buildService(prisma);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    (service as any).stripe = {
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          id: 'evt_pix_2',
          type: 'checkout.session.async_payment_failed',
          data: { object: { id: 'cs_pix_2', payment_status: 'unpaid', metadata: { kind: 'course_purchase' } } },
        }),
      },
    };

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(academyService.completePurchase).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cs_pix_2'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Async payment FAILED'));
  });

  it('logs a warning naming the session id on every silent-drop branch', async () => {
    const { service } = buildService({} as any);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    // Unpaid one-off (Pix awaiting settlement)
    await (service as any).handleCheckoutSessionCompleted({
      id: 'cs_a',
      mode: 'payment',
      payment_status: 'unpaid',
      metadata: { kind: 'course_purchase' },
    });
    // Paid but unrecognized kind — money taken, nobody claims it
    await (service as any).handleCheckoutSessionCompleted({
      id: 'cs_b',
      mode: 'payment',
      payment_status: 'paid',
      metadata: { kind: 'who_knows' },
    });
    // Subscription with unrecognized kind
    await (service as any).handleCheckoutSessionCompleted({
      id: 'cs_c',
      mode: 'subscription',
      metadata: {},
    });
    // Unsupported mode
    await (service as any).handleCheckoutSessionCompleted({ id: 'cs_d', mode: 'setup', metadata: {} });

    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('cs_a') && m.includes('payment_status=unpaid'))).toBe(true);
    expect(messages.some((m) => m.includes('cs_b') && m.includes('who_knows'))).toBe(true);
    expect(messages.some((m) => m.includes('cs_c'))).toBe(true);
    expect(messages.some((m) => m.includes('cs_d') && m.includes('setup'))).toBe(true);
  });
});

describe('StripeWebhookService — subscription renewal idempotency', () => {
  function buildSubscriptionPrisma() {
    const state = { id: 'sub-1', tier: SubscriptionTier.FREE, expiresAt: null as Date | null };
    return {
      __state: state,
      bnplInstallment: { findFirst: jest.fn().mockResolvedValue(null) },
      maintenanceAgreement: { findFirst: jest.fn().mockResolvedValue(null) },
      subscription: {
        findFirst: jest.fn(async () => ({ ...state })),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(state, data);
          return state;
        }),
      },
    };
  }

  // Feb 1 2026 -> Mar 1 2026, the period the invoice actually paid for.
  const periodEnd = Math.floor(Date.UTC(2026, 2, 1) / 1000);
  const invoice: any = {
    id: 'in_sub_1',
    customer: 'cus_1',
    subscription: 'sub_stripe_1',
    period_end: periodEnd,
    lines: { data: [{ price: { id: 'price_premium_usd' }, period: { end: periodEnd } }] },
  };

  it('derives the expiry from the invoice period, so a replay does not add another month', async () => {
    const prisma = buildSubscriptionPrisma();
    const { service } = buildService(
      prisma,
      buildConfig({ STRIPE_PRICE_PREMIUM_CLIENT_USD: 'price_premium_usd' }),
    );

    await (service as any).handleInvoicePaid(invoice);
    const afterFirst = prisma.__state.expiresAt;

    await (service as any).handleInvoicePaid(invoice);
    await (service as any).handleInvoicePaid(invoice);

    expect(afterFirst).toEqual(new Date(periodEnd * 1000));
    expect(prisma.__state.expiresAt).toEqual(afterFirst);
    expect(prisma.__state.tier).toBe(SubscriptionTier.PREMIUM_CLIENT);
  });

  it('advances the expiry when a genuinely later period is paid', async () => {
    const prisma = buildSubscriptionPrisma();
    const { service } = buildService(prisma);

    await (service as any).handleInvoicePaid(invoice);
    const nextPeriodEnd = Math.floor(Date.UTC(2026, 3, 1) / 1000);
    await (service as any).handleInvoicePaid({
      ...invoice,
      id: 'in_sub_2',
      period_end: nextPeriodEnd,
      lines: { data: [{ price: { id: 'price_premium_usd' }, period: { end: nextPeriodEnd } }] },
    });

    expect(prisma.__state.expiresAt).toEqual(new Date(nextPeriodEnd * 1000));
  });
});
