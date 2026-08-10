import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminAnalyticsService } from './admin-analytics.service';
import { DashboardMetricsQueryDto } from './dto/dashboard-metrics-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminAnalyticsService: AdminAnalyticsService) {}

  @Get('dashboard-metrics')
  getDashboardMetrics(@Query() query: DashboardMetricsQueryDto) {
    return this.adminAnalyticsService.getDashboardMetrics(query.period);
  }
}
