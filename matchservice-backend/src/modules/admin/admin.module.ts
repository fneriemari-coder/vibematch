import { Module } from '@nestjs/common';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminNewsController } from './admin-news.controller';
import { FeedModule } from '../feed/feed.module';
import { SwipesModule } from '../swipes/swipes.module';
import { EscrowModule } from '../escrow/escrow.module';
import { ChatModule } from '../chat/chat.module';
import { SimulationService } from './simulation.service';
import { SimulationBehaviourService } from './simulation-behaviour.service';
import { SimulationJourneyService } from './simulation-journey.service';
import { SimulationBotsScheduler } from './simulation-bots.scheduler';
import { SimulationController } from './simulation.controller';

@Module({
  imports: [
    // For NewsIngestionService, which FeedModule owns and exports.
    FeedModule,
    // The behavioural bots and the demo journey deliberately reuse the real
    // services instead of writing rows themselves: SwipesService owns the
    // double opt-in match creation, EscrowService owns the "B2B matches never
    // open escrow" rule, and TranslationService (from ChatModule) gives bot
    // messages the same shape the WebSocket gateway writes.
    SwipesModule,
    EscrowModule,
    ChatModule,
  ],
  providers: [
    AdminAnalyticsService,
    AdminUsersService,
    SimulationService,
    SimulationBehaviourService,
    SimulationJourneyService,
    SimulationBotsScheduler,
  ],
  controllers: [AdminController, AdminUsersController, AdminNewsController, SimulationController],
})
export class AdminModule {}
