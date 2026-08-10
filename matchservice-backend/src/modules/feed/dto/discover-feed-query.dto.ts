import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class DiscoverFeedQueryDto {
  @ValidateIf((o) => o.lng !== undefined)
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ValidateIf((o) => o.lat !== undefined)
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  /** Opaque cursor from the previous page's response — omit for the first page. See cursor.util.ts. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
