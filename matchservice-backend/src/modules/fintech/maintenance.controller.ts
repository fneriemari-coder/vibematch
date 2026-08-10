import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { ActivateMaintenanceDto } from './dto/activate-maintenance.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('fintech')
@UseGuards(JwtAuthGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post('activate-maintenance')
  activateMaintenance(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActivateMaintenanceDto) {
    return this.maintenanceService.activateFromRequest(user.id, dto);
  }
}
