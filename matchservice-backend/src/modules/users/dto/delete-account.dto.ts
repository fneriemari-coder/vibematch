import { IsString } from 'class-validator';

/** Re-confirms the current password so a stolen/short-lived access token alone can't trigger account deletion. */
export class DeleteAccountDto {
  @IsString()
  password: string;
}
