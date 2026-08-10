import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { MastermindService } from './mastermind.service';
import { CreateMastermindSessionDto } from './dto/create-session.dto';
import { UpdateMastermindSessionDto } from './dto/update-session.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('mastermind/sessions')
@UseGuards(JwtAuthGuard)
export class MastermindController {
  constructor(private readonly mastermindService: MastermindService) {}

  /** Schedule a new live mastermind — the authenticated user becomes the host. */
  @Post()
  createSession(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMastermindSessionDto) {
    return this.mastermindService.createSession(user.id, dto);
  }

  @Get()
  listUpcoming(@Query('limit') limitRaw?: string, @Query('offset') offsetRaw?: string) {
    const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : 20;
    const offset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : 0;
    return this.mastermindService.listUpcoming(limit, offset);
  }

  /** Host-only: attach or replace the real stream link. */
  @Patch(':sessionId/stream-url')
  setLiveStreamUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateMastermindSessionDto,
  ) {
    return this.mastermindService.setLiveStreamUrl(user.id, sessionId, dto.liveStreamUrl);
  }

  /** Opens Stripe Checkout for the access fee — actual booking is created by the webhook. */
  @Post(':sessionId/book')
  bookSession(@CurrentUser() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    return this.mastermindService.bookSession(user.id, sessionId);
  }

  /** Returns the stream link only if the caller is the host or has a paid booking, within the access window. */
  @Get(':sessionId/access')
  getAccess(@CurrentUser() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    return this.mastermindService.getAccess(user.id, sessionId);
  }
}
