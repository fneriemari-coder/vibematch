import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListOfferingsQueryDto {
  /** Matches offering title, description, topics, or the mentor's name. */
  @IsOptional()
  @IsString()
  search?: string;

  /** Narrows to one mentor's catalogue — see MentorshipService.listOfferings. */
  @IsOptional()
  @IsUUID()
  mentorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
