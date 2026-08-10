import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateAiCourseDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topicHint?: string;
}
