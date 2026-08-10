import { NotFoundException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { AdminUsersService } from './admin-users.service';

function buildPrisma() {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  };
}

describe('AdminUsersService', () => {
  it('listUsers() excludes deleted accounts by default', async () => {
    const prisma = buildPrisma();
    const service = new AdminUsersService(prisma as any);

    await service.listUsers({});

    const whereArg = prisma.user.findMany.mock.calls[0][0].where;
    expect(whereArg.deletedAt).toBeNull();
  });

  it('listUsers() includes deleted accounts when includeDeleted is set', async () => {
    const prisma = buildPrisma();
    const service = new AdminUsersService(prisma as any);

    await service.listUsers({ includeDeleted: true });

    const whereArg = prisma.user.findMany.mock.calls[0][0].where;
    expect(whereArg.deletedAt).toBeUndefined();
  });

  it('listUsers() searches both email and profile name', async () => {
    const prisma = buildPrisma();
    const service = new AdminUsersService(prisma as any);

    await service.listUsers({ search: 'joão' });

    const whereArg = prisma.user.findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toHaveLength(2);
  });

  it('listUsers() filters by role and accountStatus', async () => {
    const prisma = buildPrisma();
    const service = new AdminUsersService(prisma as any);

    await service.listUsers({ role: Role.PROVIDER, accountStatus: AccountStatus.UNDER_REVIEW });

    const whereArg = prisma.user.findMany.mock.calls[0][0].where;
    expect(whereArg.role).toBe(Role.PROVIDER);
    expect(whereArg.accountStatus).toBe(AccountStatus.UNDER_REVIEW);
  });

  it('updateAccountStatus() 404s for an unknown user', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const service = new AdminUsersService(prisma as any);

    await expect(service.updateAccountStatus('nope', AccountStatus.SUSPENDED)).rejects.toThrow(NotFoundException);
  });

  it('updateAccountStatus() bans a user by setting SUSPENDED', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    const service = new AdminUsersService(prisma as any);

    await service.updateAccountStatus('user-1', AccountStatus.SUSPENDED);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { accountStatus: AccountStatus.SUSPENDED } }),
    );
  });

  it('setIdentityVerified() approves manual identity verification', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    const service = new AdminUsersService(prisma as any);

    await service.setIdentityVerified('user-1', true);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { identityVerified: true } }),
    );
  });

  it('getUserDetail() 404s for an unknown user', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const service = new AdminUsersService(prisma as any);

    await expect(service.getUserDetail('nope')).rejects.toThrow(NotFoundException);
  });
});
