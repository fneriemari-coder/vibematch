import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class FinanceProjectDto {
  @IsString()
  escrowProjectId: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(12)
  installmentCount?: number = 4;
}
