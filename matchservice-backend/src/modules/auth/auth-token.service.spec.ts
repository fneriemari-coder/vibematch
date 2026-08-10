import { UnauthorizedException } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import { AuthTokenService } from './auth-token.service';
import { hashOpaqueToken } from '../../common/security/opaque-token.util';

function buildPrisma(overrides: Partial<Record<string, any>> = {}) {
  return {
    authToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    },
  };
}

describe('AuthTokenService', () => {
  it('issue() persists only the sha256 hash, never the plaintext token', async () => {
    const prisma = buildPrisma();
    const service = new AuthTokenService(prisma as any);

    const { token, expiresAt } = await service.issue('user-1', AuthTokenPurpose.REFRESH, 1000 * 60);

    const createCall = prisma.authToken.create.mock.calls[0][0];
    expect(createCall.data.userId).toBe('user-1');
    expect(createCall.data.purpose).toBe(AuthTokenPurpose.REFRESH);
    expect(createCall.data.tokenHash).toBe(hashOpaqueToken(token));
    expect(createCall.data.tokenHash).not.toBe(token);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('consume() accepts a valid, unexpired, unconsumed token of the right purpose and marks it consumed', async () => {
    const record = {
      id: 'tok-1',
      userId: 'user-1',
      purpose: AuthTokenPurpose.PASSWORD_RESET,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const prisma = buildPrisma({ findUnique: jest.fn().mockResolvedValue(record) });
    const service = new AuthTokenService(prisma as any);

    const result = await service.consume('whatever-plaintext', AuthTokenPurpose.PASSWORD_RESET);

    expect(result.userId).toBe('user-1');
    expect(prisma.authToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tok-1' }, data: expect.objectContaining({ consumedAt: expect.any(Date) }) }),
    );
  });

  it('consume() rejects an already-consumed token (no replay)', async () => {
    const prisma = buildPrisma({
      findUnique: jest.fn().mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        purpose: AuthTokenPurpose.REFRESH,
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });
    const service = new AuthTokenService(prisma as any);

    await expect(service.consume('x', AuthTokenPurpose.REFRESH)).rejects.toThrow(UnauthorizedException);
  });

  it('consume() rejects an expired token', async () => {
    const prisma = buildPrisma({
      findUnique: jest.fn().mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        purpose: AuthTokenPurpose.REFRESH,
        consumedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      }),
    });
    const service = new AuthTokenService(prisma as any);

    await expect(service.consume('x', AuthTokenPurpose.REFRESH)).rejects.toThrow(UnauthorizedException);
  });

  it('consume() rejects a token presented for the wrong purpose', async () => {
    const prisma = buildPrisma({
      findUnique: jest.fn().mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });
    const service = new AuthTokenService(prisma as any);

    await expect(service.consume('x', AuthTokenPurpose.PASSWORD_RESET)).rejects.toThrow(UnauthorizedException);
  });

  it('consume() rejects an unknown token', async () => {
    const prisma = buildPrisma({ findUnique: jest.fn().mockResolvedValue(null) });
    const service = new AuthTokenService(prisma as any);

    await expect(service.consume('nope', AuthTokenPurpose.REFRESH)).rejects.toThrow(UnauthorizedException);
  });
});
