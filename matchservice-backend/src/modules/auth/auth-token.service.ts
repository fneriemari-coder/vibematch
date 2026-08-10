import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthTokenPurpose } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/security/opaque-token.util';

const INVALID_TOKEN_MESSAGE: Record<AuthTokenPurpose, string> = {
  REFRESH: 'Invalid or expired refresh token',
  EMAIL_VERIFICATION: 'Invalid or expired verification link',
  PASSWORD_RESET: 'Invalid or expired reset link',
};

/** CRUD around the shared AuthToken table — see its schema doc comment. */
@Injectable()
export class AuthTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, purpose: AuthTokenPurpose, ttlMs: number): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.authToken.create({
      data: { userId, purpose, tokenHash: hash, expiresAt },
    });
    return { token, expiresAt };
  }

  /** Validates + single-use-consumes a token, returning the userId it belonged to. */
  async consume(tokenPlain: string, purpose: AuthTokenPurpose): Promise<{ userId: string }> {
    const hash = hashOpaqueToken(tokenPlain);
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: hash } });

    if (!record || record.purpose !== purpose || record.consumedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE[purpose]);
    }

    await this.prisma.authToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return { userId: record.userId };
  }

  /** Used on logout / password change — kills every other live session or link of that purpose. */
  async revokeAllForUser(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    await this.prisma.authToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}
