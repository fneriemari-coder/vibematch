import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { BnplService } from './bnpl.service';
import { FinanceProjectDto } from './dto/finance-project.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AntiFraudGuard } from './guards/anti-fraud.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('fintech')
@UseGuards(JwtAuthGuard, AntiFraudGuard)
export class BnplController {
  constructor(private readonly bnplService: BnplService) {}

  @Post('finance-project')
  financeProject(@CurrentUser() user: AuthenticatedUser, @Body() dto: FinanceProjectDto) {
    return this.bnplService.financeProject(user.id, dto);
  }
}
