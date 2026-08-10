import { Controller, Post, UseGuards } from '@nestjs/common';
import { ConnectService } from './connect.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('fintech/connect')
@UseGuards(JwtAuthGuard)
export class ConnectController {
  constructor(private readonly connectService: ConnectService) {}

  @Post('onboard')
  onboard(@CurrentUser() user: AuthenticatedUser) {
    return this.connectService.createOnboardingLink(user.id);
  }
}
