import { Module } from '@nestjs/common';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';

@Module({
  providers: [AdminAnalyticsService, AdminUsersService],
  controllers: [AdminController, AdminUsersController],
})
export class AdminModule {}
