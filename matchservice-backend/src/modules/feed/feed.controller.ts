import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service';
import { DiscoverFeedQueryDto } from './dto/discover-feed-query.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get('discover')
  discover(@CurrentUser() user: AuthenticatedUser, @Query() query: DiscoverFeedQueryDto) {
    return this.feedService.discover(user.id, query);
  }

  @Post('post')
  createPost(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePostDto) {
    return this.feedService.createPost(user.id, dto);
  }
}
