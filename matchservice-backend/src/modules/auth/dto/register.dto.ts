import { IsEmail, IsIn, IsString, Length, Matches } from 'class-validator';
import { Role } from '@prisma/client';

// Public self-registration can only ever create CLIENT/PROVIDER/BOTH
// accounts. ADMIN is never self-assignable — it's granted out-of-band
// (direct DB/ops action), never through this DTO.
const SELF_REGISTERABLE_ROLES = [Role.CLIENT, Role.PROVIDER, Role.BOTH] as const;

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 72, { message: 'Password must be between 8 and 72 characters' })
  password: string;

  @IsString()
  @Length(2, 80)
  name: string;

  @IsIn(SELF_REGISTERABLE_ROLES)
  role: Role;

  // ISO-3166 alpha-2 (e.g. "US", "BR"). Drives default currency, locale and
  // which Stripe price IDs are offered at checkout.
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO-3166 alpha-2 code, e.g. "US" or "BR"' })
  country: string;
}
