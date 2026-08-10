import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * LGPD/GDPR "right to access" + "right to erasure" for a user's own account.
 *
 * Erasure here means ANONYMIZATION, not a row-level DELETE: WalletTransaction,
 * EscrowProject, MaintenanceAgreement, CourseEnrollment etc. are financial/
 * contractual records this platform (and the *other* party to them) has a
 * legitimate retention obligation for — accounting, tax, dispute evidence.
 * What actually gets erased is the personally-identifying part: email, name,
 * bio, location, FCM token, and every live session/reset/verification token.
 * This is the standard, defensible interpretation of "erasure" for a
 * platform with financial record-keeping duties — never oversell it to the
 * user as "all your data is gone."
 */
@Injectable()
export class DataPrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything reasonably considered "this user's personal data," for a data-portability download. */
  async exportMyData(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        currentMode: true,
        country: true,
        walletBalance: true,
        isBot: true,
        emailVerified: true,
        emailVerifiedAt: true,
        accountStatus: true,
        identityVerified: true,
        createdAt: true,
        updatedAt: true,
        // Deliberately excluded: passwordHash (security material, not
        // "your data" in the portability sense) and authTokens (session/
        // reset/verification token hashes — meaningless without our
        // signing key, and exposing them serves no export purpose).
        profile: true,
        score: true,
        subscription: true,
        swipesMade: true,
        swipesReceived: true,
        matchesAsOne: true,
        matchesAsTwo: true,
        escrowAsClient: true,
        escrowAsProvider: true,
        chatMessages: true,
        walletTransactions: true,
        kanbanAssignments: true,
        discoveryPosts: true,
        aiProjectSuggestions: true,
        // FraudCheckLog payloads are AES-256-GCM encrypted at rest (see
        // common/security/aes-encryption.util.ts) — exported as ciphertext,
        // not decrypted, since this endpoint runs as the user, not an admin.
        fraudCheckLogs: true,
        maintenanceAsClient: true,
        maintenanceAsProvider: true,
        coursesInstructed: true,
        courseEnrollments: true,
        mastermindSessionsHosted: true,
        mastermindBookings: true,
        quizAttempts: true,
        certificates: true,
      },
    });

    return { exportedAt: new Date().toISOString(), user };
  }

  async deleteMyAccount(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.deletedAt) {
      throw new BadRequestException('Account already deleted');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Incorrect password');
    }

    // A real wallet balance is money the user is owed — deleting the
    // account shouldn't be a way to silently forfeit it. They need to
    // withdraw (or the balance needs to be zero) before we anonymize.
    if (Number(user.walletBalance) > 0) {
      throw new BadRequestException(
        `You have a wallet balance of ${user.walletBalance} ${user.country === 'BR' ? 'BRL' : 'USD'} — withdraw it before deleting your account`,
      );
    }

    // Unusable but validly-shaped bcrypt hash, so a stray login attempt
    // fails on password comparison rather than crashing on a malformed hash.
    const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@deleted.matchservice.invalid`,
          passwordHash: unusablePasswordHash,
          fcmToken: null,
          deletedAt: new Date(),
        },
      }),
      this.prisma.userProfile.updateMany({
        where: { userId },
        data: {
          name: 'Usuário removido',
          bio: '',
          skills: [],
          portfolioUrls: [],
          latitude: null,
          longitude: null,
          hourlyRate: null,
        },
      }),
      // Kill every live/pending token — refresh sessions, unused
      // verification links, unused reset links.
      this.prisma.authToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    ]);
  }
}
