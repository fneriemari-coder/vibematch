import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { NotificationsModule } from '../notifications/notifications.module';

// NotificationsModule is imported for PushNotificationService, so
// /health/integrations can report whether Firebase Admin really initialised
// rather than just whether an env var happens to be present.
@Module({
  imports: [NotificationsModule],
  controllers: [HealthController],
})
export class HealthModule {}
