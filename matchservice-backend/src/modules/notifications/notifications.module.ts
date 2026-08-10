import { Module } from '@nestjs/common';
import { PushNotificationService } from './push-notification.service';
import { TrendMonitorService } from './trend-monitor.service';

// ScheduleModule.forRoot() is registered once, globally, in AppModule — do
// not re-import it here, @nestjs/schedule's SchedulerRegistry is a singleton
// and a second forRoot() call would double-register it.
@Module({
  providers: [PushNotificationService, TrendMonitorService],
  exports: [PushNotificationService],
})
export class NotificationsModule {}
