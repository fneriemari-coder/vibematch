import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AiValidatorService } from './ai-validator.service';
import { VerifyMilestoneDto } from './dto/verify-milestone.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiValidatorController {
  constructor(private readonly aiValidatorService: AiValidatorService) {}

  @Post('verify-milestone')
  verifyMilestone(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyMilestoneDto) {
    return this.aiValidatorService.verifyMilestone(user.id, dto);
  }
}
