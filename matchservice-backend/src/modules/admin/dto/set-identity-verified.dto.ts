import { IsBoolean } from 'class-validator';

/** Manual override for identityVerified — outside the normal Stripe Identity webhook flow, for admin document review. */
export class SetIdentityVerifiedDto {
  @IsBoolean()
  identityVerified: boolean;
}
