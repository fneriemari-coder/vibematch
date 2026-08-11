import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { NewsCategory, NewsMediaKind } from '@prisma/client';

export class ListNewsQueryDto {
  /** Filter bar selection. Omit for "Tudo". */
  @IsOptional()
  @IsEnum(NewsCategory)
  category?: NewsCategory;

  /** ARTICLE / VIDEO / PAPER — lets the client render a "Vídeos" tab. */
  @IsOptional()
  @IsEnum(NewsMediaKind)
  mediaKind?: NewsMediaKind;

  /** Case-insensitive match against title and summary. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  /** Opaque cursor from the previous page's response — omit for the first page. See cursor.util.ts. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
