import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class FinanceProjectDto {
  @IsString()
  escrowProjectId: string;

  @IsOptional()
  @IsInt()
  // The product commits to "em até 4x". Allowing 12 here meant a client
  // could finance far beyond what the platform underwrites.
  @Min(2)
  @Max(4)
  installmentCount?: number = 4;
}
