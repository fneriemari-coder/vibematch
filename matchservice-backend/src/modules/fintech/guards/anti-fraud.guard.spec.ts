import { ForbiddenException } from '@nestjs/common';
import { AntiFraudGuard } from './anti-fraud.guard';
import { AccountStatus } from '@prisma/client';

function buildContext(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

function buildPrisma(overrides: Partial<Record<string, any>> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        country: 'US',
        accountStatus: AccountStatus.ACTIVE,
        identityVerified: false,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    escrowProject: { findMany: jest.fn().mockResolvedValue([]) },
    walletTransaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    providerScore: { findUnique: jest.fn().mockResolvedValue(null) },
    fraudCheckLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function buildConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    FRAUD_ENCRYPTION_KEY: 'test-fraud-encryption-key-32chars',
    ANTI_FRAUD_VELOCITY_WINDOW_MINUTES: '10',
    ANTI_FRAUD_VELOCITY_MAX_DISTINCT_PROVIDERS: '3',
    IDENTITY_VOLUME_THRESHOLD_USD: '1000',
    IDENTITY_VOLUME_THRESHOLD_BRL: '5000',
    IDENTITY_SCORE_DROP_THRESHOLD: '150',
    IDENTITY_SCORE_DROP_WINDOW_HOURS: '48',
    ...overrides,
  };
  return { get: jest.fn((key: string) => defaults[key]) };
}

describe('AntiFraudGuard', () => {
  const baseRequest = {
    method: 'POST',
    url: '/wallet/withdraw',
    route: { path: '/wallet/withdraw' },
    headers: {},
    body: {},
    ip: '203.0.113.5',
    user: { id: 'user-1' },
  };

  it('allows a clean request through', async () => {
    const guard = new AntiFraudGuard(buildPrisma() as any, buildConfig() as any);
    await expect(guard.canActivate(buildContext(baseRequest))).resolves.toBe(true);
  });

  it('blocks and freezes an account that already has 4+ distinct-provider escrows within the window', async () => {
    const prisma = buildPrisma({
      escrowProject: {
        findMany: jest.fn().mockResolvedValue([
          { providerId: 'p1' },
          { providerId: 'p2' },
          { providerId: 'p3' },
          { providerId: 'p4' },
        ]),
      },
    });
    const guard = new AntiFraudGuard(prisma as any, buildConfig() as any);

    await expect(guard.canActivate(buildContext(baseRequest))).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { accountStatus: AccountStatus.UNDER_REVIEW } }),
    );
  });

  it('allows exactly the velocity threshold (3 distinct providers) through', async () => {
    const prisma = buildPrisma({
      escrowProject: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ providerId: 'p1' }, { providerId: 'p2' }, { providerId: 'p3' }]),
      },
    });
    const guard = new AntiFraudGuard(prisma as any, buildConfig() as any);
    await expect(guard.canActivate(buildContext(baseRequest))).resolves.toBe(true);
  });

  it('blocks when BOTH IP and GPS country signals disagree with the declared country', async () => {
    const guard = new AntiFraudGuard(buildPrisma() as any, buildConfig() as any);
    const request = {
      ...baseRequest,
      headers: { 'cf-ipcountry': 'RU' },
      body: { gpsCountryHint: 'RU' },
    };
    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('does NOT block on a single mismatched signal (fails open on partial evidence)', async () => {
    const guard = new AntiFraudGuard(buildPrisma() as any, buildConfig() as any);
    const request = { ...baseRequest, headers: { 'cf-ipcountry': 'RU' }, body: {} }; // no GPS hint
    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
  });

  it('does NOT block when IP disagrees but GPS confirms the declared country', async () => {
    const guard = new AntiFraudGuard(buildPrisma() as any, buildConfig() as any);
    const request = { ...baseRequest, headers: { 'cf-ipcountry': 'RU' }, body: { gpsCountryHint: 'US' } };
    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
  });

  it('blocks any financial route when the account is already UNDER_REVIEW', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique = jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      country: 'US',
      accountStatus: AccountStatus.UNDER_REVIEW,
      identityVerified: false,
    });
    const guard = new AntiFraudGuard(prisma as any, buildConfig() as any);
    await expect(guard.canActivate(buildContext(baseRequest))).rejects.toThrow(ForbiddenException);
  });

  it('requires identity verification once cumulative volume exceeds the USD threshold', async () => {
    const prisma = buildPrisma({
      walletTransaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1500 } }) },
    });
    const guard = new AntiFraudGuard(prisma as any, buildConfig() as any);
    await expect(guard.canActivate(buildContext(baseRequest))).rejects.toThrow(/verification/i);
  });

  it('does not require identity verification once already verified, even above threshold', async () => {
    const prisma = buildPrisma({
      walletTransaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1500 } }) },
    });
    prisma.user.findUnique = jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      country: 'US',
      accountStatus: AccountStatus.ACTIVE,
      identityVerified: true,
    });
    const guard = new AntiFraudGuard(prisma as any, buildConfig() as any);
    await expect(guard.canActivate(buildContext(baseRequest))).resolves.toBe(true);
  });

  it('requires identity verification on a drastic K-Score drop within the window', async () => {
    const prisma = buildPrisma({
      providerScore: {
        findUnique: jest.fn().mockResolvedValue({
          financialHealthScore: 300,
          previousFinancialHealthScore: 600,
          previousScoreAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
        }),
      },
    });
    const guard = new AntiFraudGuard(prisma as any, buildConfig() as any);
    await expect(guard.canActivate(buildContext(baseRequest))).rejects.toThrow(/verification/i);
  });
});
