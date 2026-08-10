import { IsEnum } from 'class-validator';
import { AccountStatus } from '@prisma/client';

export class UpdateAccountStatusDto {
  @IsEnum(AccountStatus)
  accountStatus: AccountStatus;
}
