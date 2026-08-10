import { IsString } from 'class-validator';

export class WalletAdvanceDto {
  @IsString()
  escrowId: string;
}
