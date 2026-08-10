import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { FintechService } from './fintech.service';
import { WalletAdvanceDto } from './dto/wallet-advance.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { AntiFraudGuard } from './guards/anti-fraud.guard';
import { RequireTier } from '../../common/decorators/subscription-tiers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class FintechController {
  constructor(private readonly fintechService: FintechService) {}

  @Post('advance')
  @UseGuards(SubscriptionGuard, AntiFraudGuard)
  @RequireTier(SubscriptionTier.PRO_PROVIDER)
  advance(@CurrentUser() user: AuthenticatedUser, @Body() dto: WalletAdvanceDto) {
    return this.fintechService.advance(user.id, dto.escrowId);
  }

  @Post('withdraw')
  @UseGuards(AntiFraudGuard)
  withdraw(@CurrentUser() user: AuthenticatedUser, @Body() dto: WithdrawDto) {
    return this.fintechService.withdraw(user.id, dto.amount);
  }

  @Get('timeline')
  getTimeline(@CurrentUser() user: AuthenticatedUser) {
    return this.fintechService.getTimeline(user.id);
  }
}
