import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { NewsIngestionService } from '../feed/news-ingestion.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/news')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminNewsController {
  constructor(private readonly newsIngestionService: NewsIngestionService) {}

  /**
   * Runs the Radar ingestion immediately instead of waiting for the hourly
   * cron, and answers with the per-source counts — including which feeds
   * failed and why — so an operator can tell "the feed is empty because
   * nothing was published" apart from "the feed is empty because six
   * publishers are 403-ing us".
   *
   * 200 rather than 202: the caller genuinely wants to block on the result.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh() {
    return this.newsIngestionService.ingestAllSources();
  }
}
