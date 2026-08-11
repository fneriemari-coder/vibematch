import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ArticleCategory } from '@prisma/client';

export class ListArticlesQueryDto {
  @IsOptional()
  @IsEnum(ArticleCategory)
  category?: ArticleCategory;

  /** Matches title, excerpt or body, case-insensitive. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
