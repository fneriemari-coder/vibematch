import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ContentService } from './content.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { GenerateArticleDto } from './dto/generate-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('content')
@UseGuards(JwtAuthGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  /** Editorial feed for the "Conteúdo" tab — published articles only. */
  @Get('articles')
  listArticles(@Query() query: ListArticlesQueryDto) {
    return this.contentService.listArticles(query);
  }

  /**
   * Full article by slug + up to 3 related pieces in the same category.
   * Declared after the bare `articles` route above — Nest matches in
   * declaration order, so the reverse would swallow `GET /content/articles`.
   */
  @Get('articles/:slug')
  getArticle(@Param('slug') slug: string) {
    return this.contentService.getArticleBySlug(slug);
  }

  /** Any authenticated user publishes under their own name; slug + read time are derived server-side. */
  @Post('articles')
  createArticle(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateArticleDto) {
    return this.contentService.createArticle(user.id, dto);
  }

  /**
   * Writes and publishes an article FOR the caller. Works with or without
   * OPENAI_API_KEY — see ArticleGeneratorService for the local composer that
   * takes over when the model isn't reachable.
   */
  @Post('generate-article')
  generateArticle(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateArticleDto) {
    return this.contentService.generateArticle(user.id, dto);
  }
}
