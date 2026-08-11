import { Module } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { ArticleGeneratorService } from './article-generator.service';

@Module({
  providers: [ContentService, ArticleGeneratorService],
  controllers: [ContentController],
  exports: [ContentService],
})
export class ContentModule {}
