import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KanbanStatus } from '@prisma/client';

export class CreateKanbanTaskDto {
  @IsString()
  escrowProjectId: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class UpdateKanbanTaskDto {
  @IsOptional()
  @IsEnum(KanbanStatus)
  status?: KanbanStatus;

  @IsOptional()
  @IsString()
  assigneeId?: string;
}
