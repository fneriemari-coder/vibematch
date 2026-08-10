import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RequireTier } from '../../common/decorators/subscription-tiers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateKanbanTaskDto, UpdateKanbanTaskDto } from './dto/kanban-task.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** In-project Kanban board — SaaS Pro tool, gated to PREMIUM_CLIENT/PRO_PROVIDER. */
@Controller('kanban')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
@RequireTier(SubscriptionTier.PREMIUM_CLIENT, SubscriptionTier.PRO_PROVIDER)
export class KanbanController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listForProject(@CurrentUser() user: AuthenticatedUser, @Query('escrowProjectId') escrowProjectId: string) {
    await this.assertParticipant(user.id, escrowProjectId);
    return this.prisma.kanbanTask.findMany({
      where: { escrowProjectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateKanbanTaskDto) {
    await this.assertParticipant(user.id, dto.escrowProjectId);
    return this.prisma.kanbanTask.create({
      data: {
        escrowProjectId: dto.escrowProjectId,
        title: dto.title,
        description: dto.description ?? '',
        assigneeId: dto.assigneeId,
      },
    });
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateKanbanTaskDto) {
    const task = await this.prisma.kanbanTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    await this.assertParticipant(user.id, task.escrowProjectId);
    return this.prisma.kanbanTask.update({
      where: { id },
      data: { status: dto.status, assigneeId: dto.assigneeId },
    });
  }

  private async assertParticipant(userId: string, escrowProjectId: string) {
    const project = await this.prisma.escrowProject.findUnique({ where: { id: escrowProjectId } });
    if (!project) throw new NotFoundException('Escrow project not found');
    if (![project.clientId, project.providerId].includes(userId)) {
      throw new ForbiddenException('Not a participant in this project');
    }
  }
}
