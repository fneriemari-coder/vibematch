import { BnplService } from './bnpl.service';
import { EscrowStatus, PaymentModel } from '@prisma/client';

function buildTxMock() {
  return {
    escrowProject: { update: jest.fn().mockResolvedValue({ id: 'project-1', status: EscrowStatus.FUNDED }) },
    walletTransaction: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}) },
    bnplInstallment: { create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'inst', ...args.data })) },
  };
}

function buildPrismaMock(project: any, historyProjects: any[] = []) {
  const tx = buildTxMock();
  return {
    escrowProject: {
      findUnique: jest.fn().mockResolvedValue(project),
      findMany: jest.fn().mockResolvedValue(historyProjects),
    },
    subscription: {
      findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_existing' }),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    __tx: tx,
  };
}

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

const baseProject = {
  id: 'project-1',
  clientId: 'client-1',
  providerId: 'provider-1',
  budget: 1000,
  currency: 'USD',
  status: EscrowStatus.FUNDED,
  paymentModel: PaymentModel.UPFRONT,
  fundedAt: new Date(),
  client: { id: 'client-1', email: 'client@example.com' },
};

describe('BnplService.financeProject — credit heuristic', () => {
  const connectService = { payoutOrLedgerOnly: jest.fn().mockResolvedValue({ stripeTransferId: null }) };

  it('declines a client with a prior disputed project, regardless of budget', async () => {
    const prisma = buildPrismaMock(baseProject, [{ status: EscrowStatus.DISPUTED }]);
    const service = new BnplService(prisma as any, buildConfig() as any, connectService as any);

    await expect(service.financeProject('client-1', { escrowProjectId: 'project-1' })).rejects.toThrow(
      /disputed or canceled/,
    );
  });

  it('declines a first-time client (no history) over the conservative cap', async () => {
    const prisma = buildPrismaMock({ ...baseProject, budget: 10_000 }, []);
    const service = new BnplService(prisma as any, buildConfig() as any, connectService as any);

    await expect(service.financeProject('client-1', { escrowProjectId: 'project-1' })).rejects.toThrow(/capped at/);
  });

  it('approves a first-time client within the cap', async () => {
    const prisma = buildPrismaMock({ ...baseProject, budget: 2_000 }, []);
    const service = new BnplService(prisma as any, buildConfig() as any, connectService as any);

    const result = await service.financeProject('client-1', { escrowProjectId: 'project-1' });
    expect(result.status).toBe(EscrowStatus.FUNDED);
  });

  it('approves a client with a clean completed-project history above the first-time cap', async () => {
    const prisma = buildPrismaMock({ ...baseProject, budget: 10_000 }, [{ status: EscrowStatus.COMPLETED }]);
    const service = new BnplService(prisma as any, buildConfig() as any, connectService as any);

    await expect(service.financeProject('client-1', { escrowProjectId: 'project-1' })).resolves.toBeDefined();
  });

  it('computes the risk fee and net payout at the configured rate', async () => {
    const prisma = buildPrismaMock({ ...baseProject, budget: 1000 }, [{ status: EscrowStatus.COMPLETED }]);
    const service = new BnplService(prisma as any, buildConfig({ BNPL_RISK_FEE_RATE: '0.05' }) as any, connectService as any);

    const result = await service.financeProject('client-1', { escrowProjectId: 'project-1' });

    expect(result.riskFee).toBeCloseTo(50);
    expect(result.netPayoutToProvider).toBeCloseTo(950);
  });

  it('splits the budget evenly across the requested installment count', async () => {
    const prisma = buildPrismaMock({ ...baseProject, budget: 1000 }, [{ status: EscrowStatus.COMPLETED }]);
    const service = new BnplService(prisma as any, buildConfig() as any, connectService as any);

    await service.financeProject('client-1', { escrowProjectId: 'project-1', installmentCount: 4 });

    const tx = (prisma as any).__tx;
    expect(tx.bnplInstallment.create).toHaveBeenCalledTimes(4);
    expect(tx.bnplInstallment.create.mock.calls[0][0].data.amount.toString()).toBe('250');
  });

  it('rejects financing a project that is already BNPL-financed', async () => {
    const prisma = buildPrismaMock({ ...baseProject, paymentModel: PaymentModel.BNPL_FINANCED });
    const service = new BnplService(prisma as any, buildConfig() as any, connectService as any);

    await expect(service.financeProject('client-1', { escrowProjectId: 'project-1' })).rejects.toThrow(
      /already BNPL-financed/,
    );
  });

  it('rejects a requester who is not the contracting client', async () => {
    const prisma = buildPrismaMock(baseProject, [{ status: EscrowStatus.COMPLETED }]);
    const service = new BnplService(prisma as any, buildConfig() as any, connectService as any);

    await expect(service.financeProject('someone-else', { escrowProjectId: 'project-1' })).rejects.toThrow(
      /Only the contracting client/,
    );
  });
});
