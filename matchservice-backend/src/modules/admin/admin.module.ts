import { Module } from '@nestjs/common';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminController } from './admin.controller';

@Module({
  providers: [AdminAnalyticsService],
  controllers: [AdminController],
})
export class AdminModule {}
