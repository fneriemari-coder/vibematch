import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ArticleCategory } from '@prisma/client';

export class GenerateArticleDto {
  /** What the article should be about, in the author's own words. */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  topic: string;

  @IsEnum(ArticleCategory)
  category: ArticleCategory;
}
