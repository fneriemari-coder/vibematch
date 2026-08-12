import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Currency } from '@prisma/client';

export class CreateOfferingDto {
  @IsString()
  @Length(3, 140)
  title: string;

  @IsString()
  @Length(20, 4000)
  description: string;

  /** 15 minutes to a full working day — anything outside that is a typo. */
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsIn(['USD', 'BRL'])
  currency: Currency;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  topics?: string[] = [];

  /**
   * ISO-8601 instants the mentor is offering. Validated as in-the-future in
   * the service — same reason CreateMastermindSessionDto leaves `scheduledFor`
   * to the service: class-validator can't express "after now".
   */
  @IsArray()
  @IsISO8601({}, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  slots: string[];
}
