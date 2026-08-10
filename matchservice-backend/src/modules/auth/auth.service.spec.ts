import * as bcrypt from 'bcrypt';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthTokenPurpose, Role } from '@prisma/client';
import { AuthService } from './auth.service';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

function buildDeps() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    },
    providerScore: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
  const config = buildConfig({ APP_URL: 'https://app.matchservice.dev' });
  const authTokens = {
    issue: jest.fn().mockResolvedValue({ token: 'plain-token', expiresAt: new Date() }),
    consume: jest.fn(),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
  const email = { send: jest.fn().mockResolvedValue(undefined) };

  const service = new AuthService(prisma, jwt as any, config as any, authTokens as any, email as any);
  return { service, prisma, jwt, authTokens, email };
}

describe('AuthService', () => {
  it('register() rejects a duplicate email', async () => {
    const { service, prisma } = buildDeps();
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.register({ email: 'a@b.com', password: 'password123', name: 'A', role: Role.CLIENT, country: 'US' }),
    ).rejects.toThrow(ConflictException);
  });

  it('register() creates the user, sends a verification email, and returns an access+refresh pair', async () => {
    const { service, prisma, authTokens, email } = buildDeps();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      role: Role.CLIENT,
      country: 'US',
    });

    const result = await service.register({
      email: 'a@b.com',
      password: 'password123',
      name: 'A',
      role: Role.CLIENT,
      country: 'US',
    });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.refreshToken).toBe('plain-token');
    expect(authTokens.issue).toHaveBeenCalledWith('user-1', AuthTokenPurpose.EMAIL_VERIFICATION, expect.any(Number));
    expect(authTokens.issue).toHaveBeenCalledWith('user-1', AuthTokenPurpose.REFRESH, expect.any(Number));
    expect(email.send).toHaveBeenCalledWith('a@b.com', expect.stringContaining('Confirme'), expect.stringContaining('verify-email?token=plain-token'));
  });

  it('login() rejects an unknown email', async () => {
    const { service, prisma } = buildDeps();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: 'nobody@x.com', password: 'whatever' })).rejects.toThrow(UnauthorizedException);
  });

  it('login() rejects a wrong password', async () => {
    const { service, prisma } = buildDeps();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash: await bcrypt.hash('correct-password', 12),
      role: Role.CLIENT,
      country: 'US',
    });

    await expect(service.login({ email: 'a@b.com', password: 'wrong-password' })).rejects.toThrow(UnauthorizedException);
  });

  it('login() succeeds with the right password and issues an access+refresh pair', async () => {
    const { service, prisma } = buildDeps();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash: await bcrypt.hash('correct-password', 12),
      role: Role.CLIENT,
      country: 'US',
    });

    const result = await service.login({ email: 'a@b.com', password: 'correct-password' });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.refreshToken).toBe('plain-token');
  });

  it('refresh() consumes the old refresh token and rotates in a new one', async () => {
    const { service, prisma, authTokens } = buildDeps();
    authTokens.consume.mockResolvedValue({ userId: 'user-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', role: Role.CLIENT, country: 'US' });

    const result = await service.refresh('old-refresh-token');

    expect(authTokens.consume).toHaveBeenCalledWith('old-refresh-token', AuthTokenPurpose.REFRESH);
    expect(result.refreshToken).toBe('plain-token'); // the freshly-issued one, not the consumed one
  });

  it('refresh() rejects when the user backing the token no longer exists', async () => {
    const { service, prisma, authTokens } = buildDeps();
    authTokens.consume.mockResolvedValue({ userId: 'ghost' });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
  });

  it('forgotPassword() is a silent no-op for an unknown email (no user enumeration)', async () => {
    const { service, prisma, authTokens, email } = buildDeps();
    prisma.user.findUnique.mockResolvedValue(null);

    await service.forgotPassword('nobody@x.com');

    expect(authTokens.issue).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('forgotPassword() issues a reset token and emails the link for a known email', async () => {
    const { service, prisma, authTokens, email } = buildDeps();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

    await service.forgotPassword('a@b.com');

    expect(authTokens.issue).toHaveBeenCalledWith('user-1', AuthTokenPurpose.PASSWORD_RESET, expect.any(Number));
    expect(email.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.stringContaining('reset-password?token=plain-token'));
  });

  it('resetPassword() consumes the token, updates the hash, and revokes every refresh session', async () => {
    const { service, prisma, authTokens } = buildDeps();
    authTokens.consume.mockResolvedValue({ userId: 'user-1' });

    await service.resetPassword('reset-token', 'new-password-123');

    expect(authTokens.consume).toHaveBeenCalledWith('reset-token', AuthTokenPurpose.PASSWORD_RESET);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: expect.objectContaining({ passwordHash: expect.any(String) }) }),
    );
    expect(authTokens.revokeAllForUser).toHaveBeenCalledWith('user-1', AuthTokenPurpose.REFRESH);
  });

  it('verifyEmail() consumes the token and flips emailVerified on', async () => {
    const { service, prisma, authTokens } = buildDeps();
    authTokens.consume.mockResolvedValue({ userId: 'user-1' });

    await service.verifyEmail('verify-token');

    expect(authTokens.consume).toHaveBeenCalledWith('verify-token', AuthTokenPurpose.EMAIL_VERIFICATION);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: expect.objectContaining({ emailVerified: true }) }),
    );
  });

  it('resendVerification() refuses to re-send once the email is already verified', async () => {
    const { service, prisma } = buildDeps();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', email: 'a@b.com', emailVerified: true });

    await expect(service.resendVerification('user-1')).rejects.toThrow(BadRequestException);
  });

  it('logout() revokes every refresh session for the user', async () => {
    const { service, authTokens } = buildDeps();

    await service.logout('user-1');

    expect(authTokens.revokeAllForUser).toHaveBeenCalledWith('user-1', AuthTokenPurpose.REFRESH);
  });
});
