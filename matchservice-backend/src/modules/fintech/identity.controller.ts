import { Controller, Post, UseGuards } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('fintech')
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post('verify-identity')
  verifyIdentity(@CurrentUser() user: AuthenticatedUser) {
    return this.identityService.createVerificationSession(user.id);
  }
}
