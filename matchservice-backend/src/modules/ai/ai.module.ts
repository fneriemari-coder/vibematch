import { Module } from '@nestjs/common';
import { AiTranslatorService } from './ai-translator.service';
import { AiController } from './ai.controller';
import { AiPublisherService } from './ai-publisher.service';
import { AiModeratorService } from './ai-moderator.service';
import { AiValidatorService } from './ai-validator.service';
import { AiValidatorController } from './ai-validator.controller';
import { AiWatcherService } from './ai-watcher.service';
import { AiRetentionPushService } from './ai-retention-push.service';
import { UsersModule } from '../users/users.module';
import { FintechModule } from '../fintech/fintech.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [UsersModule, FintechModule, NotificationsModule],
  providers: [
    AiTranslatorService,
    AiPublisherService,
    AiModeratorService,
    AiValidatorService,
    AiWatcherService,
    AiRetentionPushService,
  ],
  controllers: [AiController, AiValidatorController],
  exports: [AiTranslatorService, AiModeratorService],
})
export class AiModule {}
