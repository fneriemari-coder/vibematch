import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Elevates a user into (or removes them from) the curated mentors group
 * surfaced by GET /academy/mentors. Admin-only by design — a user must never
 * be able to grant themselves mentor status.
 */
export class SetMentorDto {
  @IsBoolean()
  isMentor: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  topics?: string[];
}
