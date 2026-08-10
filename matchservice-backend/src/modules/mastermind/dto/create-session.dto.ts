import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUrl, Length, Min } from 'class-validator';
import { Currency } from '@prisma/client';

export class CreateMastermindSessionDto {
  @IsString()
  @Length(3, 140)
  title: string;

  @IsNumber()
  @Min(0)
  accessFee: number;

  @IsIn(['USD', 'BRL'])
  currency: Currency;

  // ISO-8601 — validated as in-the-future in the service (needs `new Date()`,
  // which class-validator's decorators alone can't express).
  @IsISO8601()
  scheduledFor: string;

  // Real host-supplied stream URL (Zoom/YouTube Live/etc.). Optional at
  // creation — a host may schedule the session before the link exists and
  // set it later via PATCH.
  @IsOptional()
  @IsUrl()
  liveStreamUrl?: string;
}
