import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SavedNewsQueryDto {
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
