import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Standard "must be logged in" guard — delegates to JwtStrategy. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
