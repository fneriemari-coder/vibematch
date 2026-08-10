import { IsEnum, IsNumber, IsPositive, IsString } from 'class-validator';
import { Currency } from '@prisma/client';

export class CreateEscrowDto {
  @IsString()
  matchId: string;

  @IsString()
  clientId: string;

  @IsString()
  providerId: string;

  @IsNumber()
  @IsPositive()
  budget: number;

  @IsEnum(Currency)
  currency: Currency;
}
