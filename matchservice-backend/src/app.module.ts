import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SwipesModule } from './modules/swipes/swipes.module';
import { EscrowModule } from './modules/escrow/escrow.module';
import { FintechModule } from './modules/fintech/fintech.module';
import { ChatModule } from './modules/chat/chat.module';
import { AiModule } from './modules/ai/ai.module';
import { FeedModule } from './modules/feed/feed.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AcademyModule } from './modules/academy/academy.module';
import { AdminModule } from './modules/admin/admin.module';
import { MediaModule } from './modules/media/media.module';
import { MastermindModule } from './modules/mastermind/mastermind.module';
import { HealthModule } from './modules/health/health.module';
import { ObservabilityModule } from './common/observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    // App-wide rate limit — a generous ceiling so normal usage never notices
    // it. auth.controller.ts layers a much tighter per-route limit on top
    // of this for login/register/refresh/password-reset/email-verification,
    // where brute-forcing is the actual risk.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    SwipesModule,
    EscrowModule,
    FintechModule,
    ChatModule,
    AiModule,
    FeedModule,
    NotificationsModule,
    AcademyModule,
    AdminModule,
    MediaModule,
    MastermindModule,
    HealthModule,
    ObservabilityModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
