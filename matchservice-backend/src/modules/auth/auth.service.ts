import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthTokenPurpose, Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt.strategy';
import { AuthTokenService } from './auth-token.service';
import { EmailService } from './email.service';

const SALT_ROUNDS = 12;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMAIL_VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: JwtPayload['role']; country: string };
}

@Injectable()
export class AuthService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authTokens: AuthTokenService,
    private readonly email: EmailService,
  ) {
    this.appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const defaultCurrency: Currency = dto.country === 'BR' ? 'BRL' : 'USD';

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: dto.role,
          country: dto.country,
          profile: {
            create: {
              name: dto.name,
              rateCurrency: defaultCurrency,
            },
          },
          subscription: {
            create: { tier: 'FREE', currency: defaultCurrency },
          },
        },
        include: { profile: true },
      });

      // Providers get a score row from day one so they always have a rank in
      // the swipe stack, even before completing their first job.
      if (created.role === 'PROVIDER' || created.role === 'BOTH') {
        await tx.providerScore.create({ data: { providerId: created.id } });
      }

      return created;
    });

    await this.sendVerificationEmail(user.id, user.email);

    return this.buildAuthResponse(user.id, user.email, user.role, user.country);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user.id, user.email, user.role, user.country);
  }

  /** Rotates the refresh token on every use — the consumed one can never be replayed. */
  async refresh(refreshTokenPlain: string): Promise<AuthResponse> {
    const { userId } = await this.authTokens.consume(refreshTokenPlain, AuthTokenPurpose.REFRESH);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return this.buildAuthResponse(user.id, user.email, user.role, user.country);
  }

  /** Revokes every live refresh session for this user — "log out everywhere." */
  async logout(userId: string): Promise<void> {
    await this.authTokens.revokeAllForUser(userId, AuthTokenPurpose.REFRESH);
  }

  /**
   * Always resolves the same way whether or not the email exists — the
   * endpoint must not let an attacker enumerate registered addresses.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const { token } = await this.authTokens.issue(user.id, AuthTokenPurpose.PASSWORD_RESET, PASSWORD_RESET_TTL_MS);
    const resetLink = `${this.appUrl}/reset-password?token=${token}`;
    await this.email.send(
      user.email,
      'Redefina sua senha — VIBE MATCH',
      `Recebemos uma solicitação para redefinir sua senha. Se foi você, use o link abaixo (válido por 1 hora):\n\n${resetLink}\n\nSe não foi você, ignore este e-mail.`,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId } = await this.authTokens.consume(token, AuthTokenPurpose.PASSWORD_RESET);
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // A password reset invalidates every existing session — otherwise a
    // stolen device/token would survive the very reset meant to lock it out.
    await this.authTokens.revokeAllForUser(userId, AuthTokenPurpose.REFRESH);
  }

  async verifyEmail(token: string): Promise<void> {
    const { userId } = await this.authTokens.consume(token, AuthTokenPurpose.EMAIL_VERIFICATION);
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }
    await this.sendVerificationEmail(user.id, user.email);
  }

  private async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const { token } = await this.authTokens.issue(userId, AuthTokenPurpose.EMAIL_VERIFICATION, EMAIL_VERIFICATION_TTL_MS);
    const verifyLink = `${this.appUrl}/verify-email?token=${token}`;
    await this.email.send(
      email,
      'Confirme seu e-mail — VIBE MATCH',
      `Bem-vindo(a)! Confirme seu e-mail pelo link abaixo (válido por 48 horas):\n\n${verifyLink}`,
    );
  }

  private async buildAuthResponse(
    sub: string,
    email: string,
    role: JwtPayload['role'],
    country: string,
  ): Promise<AuthResponse> {
    const payload: JwtPayload = { sub, email, role, country };
    const { token: refreshToken } = await this.authTokens.issue(sub, AuthTokenPurpose.REFRESH, REFRESH_TOKEN_TTL_MS);
    return {
      accessToken: this.jwt.sign(payload),
      refreshToken,
      user: { id: sub, email, role, country },
    };
  }
}
