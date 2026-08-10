import { IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

export class VerifyMilestoneDto {
  @IsString()
  milestoneId: string;

  @ValidateIf((o) => !o.deliverableText)
  @IsUrl()
  deliverableUrl?: string;

  @ValidateIf((o) => !o.deliverableUrl)
  @IsString()
  @MaxLength(4000)
  deliverableText?: string;
}
