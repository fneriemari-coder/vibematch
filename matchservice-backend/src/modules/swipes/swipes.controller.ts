import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SwipesService } from './swipes.service';
import { CreateSwipeDto } from './dto/create-swipe.dto';
import { StackQueryDto } from './dto/stack-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { EnforceSwipeLimit } from '../../common/decorators/enforce-swipe-limit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('swipes')
@UseGuards(JwtAuthGuard)
export class SwipesController {
  constructor(private readonly swipesService: SwipesService) {}

  @Get('stack')
  getStack(@CurrentUser() user: AuthenticatedUser, @Query() query: StackQueryDto) {
    return this.swipesService.getStack(user.id, query);
  }

  @Post()
  @UseGuards(SubscriptionGuard)
  @EnforceSwipeLimit()
  swipe(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSwipeDto) {
    return this.swipesService.swipe(user.id, dto);
  }

  @Get('matches')
  listMyMatches(@CurrentUser() user: AuthenticatedUser) {
    return this.swipesService.listMyMatches(user.id);
  }
}
