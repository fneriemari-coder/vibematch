import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { ArticleCategory } from '@prisma/client';

/**
 * `slug` and `readMinutes` are deliberately absent — both are derived
 * server-side in ContentService.createArticle so a client can neither squat a
 * URL nor inflate a reading time.
 */
export class CreateArticleDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(20)
  @MaxLength(600)
  excerpt: string;

  @IsString()
  @MinLength(200)
  body: string;

  @IsEnum(ArticleCategory)
  category: ArticleCategory;

  @IsOptional()
  @IsUrl()
  coverImageUrl?: string;
}
