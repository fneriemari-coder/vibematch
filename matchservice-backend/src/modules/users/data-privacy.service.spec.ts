import * as bcrypt from 'bcrypt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DataPrivacyService } from './data-privacy.service';

function buildPrisma(userOverrides: Record<string, any> = {}) {
  const user = {
    id: 'user-1',
    email: 'a@b.com',
    passwordHash: '',
    walletBalance: new Prisma.Decimal(0),
    country: 'US',
    deletedAt: null,
    ...userOverrides,
  };
  return {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user), update: jest.fn() },
    userProfile: { updateMany: jest.fn() },
    authToken: { updateMany: jest.fn() },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  };
}

describe('DataPrivacyService', () => {
  it('exportMyData() never includes passwordHash', async () => {
    const prisma: any = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'user-1' }) } };
    const service = new DataPrivacyService(prisma);

    await service.exportMyData('user-1');

    const selectArg = prisma.user.findUniqueOrThrow.mock.calls[0][0].select;
    expect(selectArg.passwordHash).toBeUndefined();
    expect(selectArg.authTokens).toBeUndefined();
  });

  it('deleteMyAccount() rejects the wrong password', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    const prisma = buildPrisma({ passwordHash });
    const service = new DataPrivacyService(prisma as any);

    await expect(service.deleteMyAccount('user-1', 'wrong-password')).rejects.toThrow(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deleteMyAccount() refuses to run while the wallet still has a balance', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    const prisma = buildPrisma({ passwordHash, walletBalance: new Prisma.Decimal(150) });
    const service = new DataPrivacyService(prisma as any);

    await expect(service.deleteMyAccount('user-1', 'correct-password')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deleteMyAccount() refuses to run twice', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    const prisma = buildPrisma({ passwordHash, deletedAt: new Date() });
    const service = new DataPrivacyService(prisma as any);

    await expect(service.deleteMyAccount('user-1', 'correct-password')).rejects.toThrow(BadRequestException);
  });

  it('deleteMyAccount() scrambles email/password, anonymizes the profile, and revokes every token', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    const prisma = buildPrisma({ passwordHash });
    const service = new DataPrivacyService(prisma as any);

    await service.deleteMyAccount('user-1', 'correct-password');

    expect(prisma.$transaction).toHaveBeenCalled();
    const userUpdateData = prisma.user.update.mock.calls[0][0].data;
    expect(userUpdateData.email).toContain('deleted-user-1@');
    expect(userUpdateData.deletedAt).toBeInstanceOf(Date);
    expect(userUpdateData.passwordHash).not.toBe(passwordHash);

    const profileUpdateData = prisma.userProfile.updateMany.mock.calls[0][0].data;
    expect(profileUpdateData.name).toBe('Usuário removido');
    expect(profileUpdateData.skills).toEqual([]);

    expect(prisma.authToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', consumedAt: null } }),
    );
  });
});
