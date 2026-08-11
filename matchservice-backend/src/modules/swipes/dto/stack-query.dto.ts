import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { SwipeMode } from '@prisma/client';

export class StackQueryDto {
  @IsEnum(SwipeMode)
  mode: SwipeMode;

  // Required when mode === LOCAL — validated in SwipesService rather than
  // via class-validator's conditional decorators to keep the error message
  // domain-specific ("Local mode requires lat/lng").
  @ValidateIf((o) => o.mode === SwipeMode.LOCAL)
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ValidateIf((o) => o.mode === SwipeMode.LOCAL)
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(500)
  radiusKm?: number = 25;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  /**
   * A `PostTag` row id, sent by the Discovery Feed's "Implementar no meu
   * Negócio" CTA. The service resolves it to that tag's name and keeps only
   * providers who list the skill, so the deck matches the post the user came
   * from. Unknown ids fall through to the unfiltered deck rather than
   * returning nothing.
   */
  @IsOptional()
  @IsString()
  skillTagId?: string;
}
