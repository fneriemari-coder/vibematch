import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ChatController } from './chat.controller';
import { KanbanController } from './kanban.controller';
import { TranslationService } from './translation.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') ?? '7d' },
      }),
    }),
  ],
  providers: [ChatGateway, TranslationService],
  controllers: [ChatController, KanbanController],
  // AdminModule's simulation bots persist chat messages with the same
  // sourceLang/targetLang/translatedContent fields the gateway writes, and
  // that resolution lives here.
  exports: [TranslationService],
})
export class ChatModule {}
