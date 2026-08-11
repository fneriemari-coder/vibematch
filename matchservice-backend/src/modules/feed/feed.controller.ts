import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service';
import { NewsService } from './news.service';
import { DiscoverFeedQueryDto } from './dto/discover-feed-query.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { ListNewsQueryDto } from './dto/list-news-query.dto';
import { SavedNewsQueryDto } from './dto/saved-news-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly newsService: NewsService,
  ) {}

  @Get('discover')
  discover(@CurrentUser() user: AuthenticatedUser, @Query() query: DiscoverFeedQueryDto) {
    return this.feedService.discover(user.id, query);
  }

  @Post('post')
  createPost(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePostDto) {
    return this.feedService.createPost(user.id, dto);
  }

  // --- Radar (external news/video/papers) ---------------------------------
  // Declared BEFORE the `:itemId` routes below only as a readability
  // convention; Nest matches on the full literal path, so `saved` can't be
  // swallowed by `:itemId` here (different HTTP verbs/segments).

  @Get('news')
  listNews(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNewsQueryDto) {
    return this.newsService.listNews(user.id, query);
  }

  @Get('news/saved')
  listSavedNews(@CurrentUser() user: AuthenticatedUser, @Query() query: SavedNewsQueryDto) {
    return this.newsService.listSaved(user.id, query);
  }

  @Post('news/:itemId/save')
  saveNews(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string) {
    return this.newsService.save(user.id, itemId);
  }

  @Delete('news/:itemId/save')
  unsaveNews(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string) {
    return this.newsService.unsave(user.id, itemId);
  }

  /** Impression counter for the analytics/ranking loop — no body to return. */
  @Post('news/:itemId/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerNewsView(@Param('itemId') itemId: string) {
    return this.newsService.registerView(itemId);
  }
}
