import { Module } from '@nestjs/common';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';
import { NewsService } from './news.service';
import { NewsIngestionService } from './news-ingestion.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [FeedService, NewsService, NewsIngestionService],
  controllers: [FeedController],
  // AdminModule imports this to expose POST /admin/news/refresh, so the owner
  // can populate the Radar feed on demand instead of waiting for the cron.
  exports: [NewsIngestionService],
})
export class FeedModule {}
