import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SimulationService } from './simulation.service';
import { SimulationBehaviourService } from './simulation-behaviour.service';
import { SimulationJourneyService } from './simulation-journey.service';
import { CreateSimulatedUsersDto } from './dto/create-simulated-users.dto';
import { SimulationFeedPostsQueryDto } from './dto/simulation-feed-posts-query.dto';
import { RunDemoJourneyDto } from './dto/run-demo-journey.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Population simulator — admin-only, same guard stack as the rest of
 * `AdminModule`. Everything it creates lives on the reserved
 * `@simulado.vibematch.dev` domain and is removable in one call.
 */
@Controller('admin/simulation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SimulationController {
  constructor(
    private readonly simulationService: SimulationService,
    private readonly behaviourService: SimulationBehaviourService,
    private readonly journeyService: SimulationJourneyService,
  ) {}

  /** Creates `count` (1–200) complete simulated profiles, capped at 500 simulated users in total. */
  @Post('users')
  createSimulatedUsers(@Body() dto: CreateSimulatedUsersDto) {
    return this.simulationService.createSimulatedUsers(dto);
  }

  /**
   * Removes every simulated account and everything the bots created for it.
   * Scoped by the reserved domain, so real users are unreachable.
   */
  @Delete('users')
  deleteSimulatedUsers() {
    return this.simulationService.deleteSimulatedUsers();
  }

  @Get('status')
  getStatus() {
    return this.simulationService.getStatus();
  }

  /** Simulated professionals answer every unanswered right-swipe from a real user. */
  @Post('reciprocate')
  reciprocate() {
    return this.behaviourService.reciprocatePendingSwipes();
  }

  /** Simulated professionals reply in every conversation where a real user spoke last. */
  @Post('chat-replies')
  chatReplies() {
    return this.behaviourService.replyToPendingChats();
  }

  /** Simulated professionals publish Discovery Feed posts. */
  @Post('feed-posts')
  feedPosts(@Query() query: SimulationFeedPostsQueryDto) {
    return this.behaviourService.publishFeedPosts(query.count ?? 10);
  }

  /**
   * Runs one simulated professional through the whole funnel against a real
   * user: match, chat, escrow, funding, milestones and completion. Defaults
   * to the calling admin. Simulated contract lifecycle — no real money moves.
   */
  @Post('demo-journey')
  demoJourney(@CurrentUser() user: AuthenticatedUser, @Body() dto: RunDemoJourneyDto) {
    return this.journeyService.runDemoJourney(dto.userId ?? user.id);
  }
}
