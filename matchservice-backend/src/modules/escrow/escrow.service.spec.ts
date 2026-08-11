import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Currency, EscrowStatus, WalletTransactionType } from '@prisma/client';
import { EscrowService } from './escrow.service';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

const baseProject = {
  id: 'project-1',
  matchId: 'match-1',
  clientId: 'client-1',
  providerId: 'provider-1',
  budget: 1000,
  currency: Currency.USD,
  status: EscrowStatus.FUNDED,
  advanced: false,
  stripePaymentIntentId: null as string | null,
};

function buildPrisma(project: any = baseProject, priorReleaseSum: number | null = null) {
  return {
    escrowProject: {
      findUnique: jest.fn().mockResolvedValue(project),
      update: jest.fn(async ({ data }: any) => ({ ...project, ...data })),
    },
    walletTransaction: {
      create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: priorReleaseSum } }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: {
      update: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'client-1', email: 'client@example.com' }),
    },
    subscription: { findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_1' }), upsert: jest.fn() },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  };
}

function buildService(prisma: any, config = buildConfig()) {
  const scoreEngine = { recalculate: jest.fn().mockResolvedValue(undefined) };
  const maintenanceService = { activateIfEligible: jest.fn().mockResolvedValue(undefined) };
  const connectService = { payoutOrLedgerOnly: jest.fn().mockResolvedValue({ stripeTransferId: null }) };
  const service = new EscrowService(
    prisma as any,
    config as any,
    scoreEngine as any,
    maintenanceService as any,
    connectService as any,
  );
  return { service, scoreEngine, maintenanceService, connectService };
}

describe('EscrowService.complete — real ESCROW_RELEASE payout', () => {
  it('writes an ESCROW_RELEASE row, credits the provider wallet and completes the project in one transaction', async () => {
    const prisma = buildPrisma();
    const { service, connectService } = buildService(prisma);

    const updated = await service.complete('project-1', 'client-1');

    // Default take rate 3% -> provider 970, platform 30.
    const created = prisma.walletTransaction.create.mock.calls[0][0].data;
    expect(created.userId).toBe('provider-1');
    expect(created.type).toBe(WalletTransactionType.ESCROW_RELEASE);
    expect(created.amount.toString()).toBe('970');
    expect(created.relatedEscrowId).toBe('project-1');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'provider-1' } }),
    );
    expect(prisma.user.update.mock.calls[0][0].data.walletBalance.increment.toString()).toBe('970');

    // All three writes went through a single $transaction call.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);

    expect(updated.status).toBe(EscrowStatus.COMPLETED);
    expect(updated.completedAt).toBeInstanceOf(Date);

    // Real transfer attempted OUTSIDE the transaction.
    expect(connectService.payoutOrLedgerOnly).toHaveBeenCalledWith(
      'provider-1',
      970,
      Currency.USD,
      expect.objectContaining({ kind: 'escrow_release', escrowProjectId: 'project-1' }),
    );
  });

  it.each([
    [1000, 0.03],
    [999.99, 0.03],
    [100.01, 0.03],
    [0.01, 0.03],
    [33.33, 0.03],
    [1234.56, 0.15],
    [7.77, 0.2],
    [0.03, 0.2],
    [19.99, 0.075],
  ])('splits a budget of %s at rate %s with no cent lost', async (budget, rate) => {
    const prisma = buildPrisma({ ...baseProject, budget });
    const { service } = buildService(
      prisma,
      buildConfig({ PLATFORM_ESCROW_TAKE_RATE: String(rate) }),
    );

    await service.complete('project-1', 'client-1');

    const created = prisma.walletTransaction.create.mock.calls[0][0].data;
    const providerShare = Number(created.amount.toString());
    const platformShare = created.metadata.platformShare;

    // The invariant: the two shares reconstruct the budget EXACTLY.
    expect(Number((providerShare + platformShare).toFixed(2))).toBe(budget);
    // Both are whole cents.
    expect(Number.isInteger(Math.round(providerShare * 100))).toBe(true);
    expect(providerShare).toBeCloseTo(Number((providerShare * 100).toFixed(0)) / 100, 10);
    // The platform absorbs the rounding remainder, never the provider.
    expect(providerShare).toBe(Number((budget * (1 - rate)).toFixed(2)));
  });

  it('refuses to complete a PENDING project — there is no money behind it', async () => {
    const prisma = buildPrisma({ ...baseProject, status: EscrowStatus.PENDING });
    const { service } = buildService(prisma);

    await expect(service.complete('project-1', 'client-1')).rejects.toThrow(BadRequestException);
    await expect(service.complete('project-1', 'client-1')).rejects.toThrow(
      /Cannot complete a project in status PENDING/,
    );
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still refuses a non-client caller', async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma);
    await expect(service.complete('project-1', 'provider-1')).rejects.toThrow(ForbiddenException);
  });

  it('nets off a receivables advance so an advanced project is not paid twice', async () => {
    // Provider already cashed out 950 (budget 1000 less the 5% advance fee).
    const prisma = buildPrisma({ ...baseProject, advanced: true }, 950);
    const { service, connectService } = buildService(prisma);

    await service.complete('project-1', 'client-1');

    // Share is 970; 950 already paid -> only the 20 top-up is released.
    const created = prisma.walletTransaction.create.mock.calls[0][0].data;
    expect(created.amount.toString()).toBe('20');
    expect(connectService.payoutOrLedgerOnly).toHaveBeenCalledWith(
      'provider-1',
      20,
      Currency.USD,
      expect.anything(),
    );
  });

  it('releases nothing (but still completes) when prior payouts already cover the share', async () => {
    const prisma = buildPrisma(baseProject, 970);
    const { service, connectService, scoreEngine } = buildService(prisma);

    const updated = await service.complete('project-1', 'client-1');

    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    expect(connectService.payoutOrLedgerOnly).not.toHaveBeenCalled();
    expect(updated.status).toBe(EscrowStatus.COMPLETED);
    expect(scoreEngine.recalculate).toHaveBeenCalledWith('provider-1');
  });

  it('falls back to the 3% default when PLATFORM_ESCROW_TAKE_RATE is nonsense', async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma, buildConfig({ PLATFORM_ESCROW_TAKE_RATE: 'abc' }));

    await service.complete('project-1', 'client-1');

    expect(prisma.walletTransaction.create.mock.calls[0][0].data.amount.toString()).toBe('970');
  });
});

describe('EscrowService.fund — opens a Checkout Session instead of granting FUNDED for free', () => {
  function stubStripe(service: EscrowService) {
    const create = jest.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    (service as any).stripe = {
      checkout: { sessions: { create } },
      customers: { create: jest.fn() },
    };
    return create;
  }

  it('returns a checkoutUrl and leaves the project PENDING', async () => {
    const prisma = buildPrisma({ ...baseProject, status: EscrowStatus.PENDING });
    const { service } = buildService(prisma, buildConfig({ APP_URL: 'https://app.example.com' }));
    const create = stubStripe(service);

    const result = await service.fund('project-1', 'client-1');

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(result.status).toBe(EscrowStatus.PENDING);
    // The critical regression guard: funding must not write the status.
    expect(prisma.escrowProject.update).not.toHaveBeenCalled();

    const args = create.mock.calls[0][0];
    expect(args.mode).toBe('payment');
    expect(args.customer).toBe('cus_1');
    expect(args.line_items[0].price_data.unit_amount).toBe(100_000); // 1000.00 USD in cents
    expect(args.line_items[0].price_data.currency).toBe('usd');
    expect(args.success_url).toBe('https://app.example.com/escrow/fund-success');
    expect(args.cancel_url).toBe('https://app.example.com/escrow/fund-cancel');
    expect(args.metadata).toEqual({
      kind: 'escrow_funding',
      escrowProjectId: 'project-1',
      clientId: 'client-1',
      providerId: 'provider-1',
    });
    // Stamped on the PaymentIntent too, so refund() can find the charge.
    expect(args.payment_intent_data.metadata).toEqual(args.metadata);
  });

  it('keeps the participant/authorization checks', async () => {
    const prisma = buildPrisma({ ...baseProject, status: EscrowStatus.PENDING });
    const { service } = buildService(prisma);
    stubStripe(service);

    await expect(service.fund('project-1', 'provider-1')).rejects.toThrow(ForbiddenException);
    await expect(service.fund('project-1', 'provider-1')).rejects.toThrow(
      /Only the client can fund this project/,
    );
  });

  it('keeps the PENDING-only status check', async () => {
    const prisma = buildPrisma({ ...baseProject, status: EscrowStatus.FUNDED });
    const { service } = buildService(prisma);
    stubStripe(service);

    await expect(service.fund('project-1', 'client-1')).rejects.toThrow(
      /Cannot fund a project in status FUNDED/,
    );
  });
});

describe('EscrowService.refund — real Stripe refund', () => {
  it('refunds the PaymentIntent stored on the project, then flips to REFUNDED', async () => {
    const prisma = buildPrisma({
      ...baseProject,
      status: EscrowStatus.DISPUTED,
      stripePaymentIntentId: 'pi_123',
    });
    const { service } = buildService(prisma);
    const refundsCreate = jest.fn().mockResolvedValue({ id: 're_1', amount: 100_000, currency: 'usd' });
    (service as any).stripe = { refunds: { create: refundsCreate } };

    const result = await service.refund('project-1', 'client-1');

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_123' }),
    );
    // The column is a plain lookup — no ledger scan, no Stripe search needed.
    expect(prisma.walletTransaction.findFirst).not.toHaveBeenCalled();
    expect(result.status).toBe(EscrowStatus.REFUNDED);
    expect(result.stripeRefundId).toBe('re_1');
  });

  it('falls back to the DEPOSIT ledger row for a project funded before the column existed', async () => {
    const prisma = buildPrisma({ ...baseProject, status: EscrowStatus.DISPUTED });
    prisma.walletTransaction.findFirst.mockResolvedValue({
      id: 'tx-deposit',
      metadata: { kind: 'escrow_funding', checkoutSessionId: 'cs_1', paymentIntentId: 'pi_legacy' },
    });
    const { service } = buildService(prisma);
    const refundsCreate = jest.fn().mockResolvedValue({ id: 're_2', amount: 100_000, currency: 'usd' });
    (service as any).stripe = { refunds: { create: refundsCreate } };

    await service.refund('project-1', 'client-1');

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_legacy' }),
    );
  });

  it('leaves the project DISPUTED when Stripe rejects the refund', async () => {
    const prisma = buildPrisma({
      ...baseProject,
      status: EscrowStatus.DISPUTED,
      stripePaymentIntentId: 'pi_123',
    });
    const { service } = buildService(prisma);
    (service as any).stripe = {
      refunds: { create: jest.fn().mockRejectedValue(new Error('charge already refunded')) },
    };

    await expect(service.refund('project-1', 'client-1')).rejects.toThrow(/charge already refunded/);
    expect(prisma.escrowProject.update).not.toHaveBeenCalled();
  });

  it('refuses to mark REFUNDED when no Stripe payment can be found at all', async () => {
    const prisma = buildPrisma({ ...baseProject, status: EscrowStatus.DISPUTED });
    const { service } = buildService(prisma);
    (service as any).stripe = {
      refunds: { create: jest.fn() },
      paymentIntents: { search: jest.fn().mockResolvedValue({ data: [] }) },
    };

    await expect(service.refund('project-1', 'client-1')).rejects.toThrow(
      /No Stripe payment found for escrow project/,
    );
    expect(prisma.escrowProject.update).not.toHaveBeenCalled();
  });

  it('only refunds DISPUTED projects', async () => {
    const prisma = buildPrisma({ ...baseProject, status: EscrowStatus.FUNDED });
    const { service } = buildService(prisma);
    await expect(service.refund('project-1', 'client-1')).rejects.toThrow(
      /Only disputed projects can be refunded/,
    );
  });
});
