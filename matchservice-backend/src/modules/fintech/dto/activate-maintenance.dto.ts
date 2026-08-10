import { IsBoolean, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

export class ActivateMaintenanceDto {
  @IsString()
  projectId: string;

  // All optional — when this is triggered automatically on project
  // completion (see EscrowService.complete / AiValidatorService), sensible
  // defaults are computed from the project's own budget instead.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  monthlyFee?: number;

  @IsOptional()
  @IsBoolean()
  hostingIncluded?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(160)
  supportHoursAllocated?: number;
}
