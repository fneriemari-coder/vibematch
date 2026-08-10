import { IsString, Length } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @Length(8, 72, { message: 'Password must be between 8 and 72 characters' })
  newPassword: string;
}
