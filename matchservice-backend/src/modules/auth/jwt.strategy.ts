import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: Role;
  country: string;
}

/** Shape Nest attaches to `request.user` on every authenticated route. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  country: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Re-hits the DB on every request rather than trusting the payload blindly —
   * cheap for an MVP's traffic and guarantees a deactivated/deleted user is
   * rejected immediately instead of riding out a stale 7-day token.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, country: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User no longer exists');
    }
    return user;
  }
}
