import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EscrowStatus, MatchType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScoreEngine } from '../users/score.engine';
import { MaintenanceService } from '../fintech/maintenance.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoreEngine: ScoreEngine,
    private readonly maintenanceService: MaintenanceService,
  ) {}

  /**
   * Opens an Escrow project for a SERVICE match. B2B matches only open a
   * partnership chat and must never generate an Escrow project — enforced here.
   */
  async create(requesterId: string, dto: CreateEscrowDto) {
    const match = await this.prisma.match.findUnique({ where: { id: dto.matchId } });
    if (!match) throw new NotFoundException('Match not found');

    if (match.type === MatchType.B2B) {
      throw new BadRequestException('B2B matches open a partnership chat only — no Escrow project');
    }

    const participants = [match.userOneId, match.userTwoId];
    if (!participants.includes(requesterId)) {
      throw new ForbiddenException('You are not a participant in this match');
    }
    if (dto.clientId === dto.providerId) {
      throw new BadRequestException('clientId and providerId must be different users');
    }
    const sameParticipants =
      participants.includes(dto.clientId) && participants.includes(dto.providerId);
    if (!sameParticipants) {
      throw new BadRequestException('clientId/providerId must be the two users of this match');
    }

    try {
      return await this.prisma.escrowProject.create({
        data: {
          matchId: dto.matchId,
          clientId: dto.clientId,
          providerId: dto.providerId,
          budget: new Prisma.Decimal(dto.budget),
          currency: dto.currency,
          status: EscrowStatus.PENDING,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('This match already has an Escrow project');
      }
      throw err;
    }
  }

  async findById(id: string) {
    const project = await this.prisma.escrowProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Escrow project not found');
    return project;
  }

  async listForUser(userId: string) {
    return this.prisma.escrowProject.findMany({
      where: { OR: [{ clientId: userId }, { providerId: userId }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Client deposits funds — only from PENDING. */
  async fund(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (project.clientId !== userId) {
      throw new ForbiddenException('Only the client can fund this project');
    }
    if (project.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(`Cannot fund a project in status ${project.status}`);
    }
    return this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.FUNDED, fundedAt: new Date() },
    });
  }

  /** Client confirms delivery and releases escrowed funds to the provider. */
  async complete(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (project.clientId !== userId) {
      throw new ForbiddenException('Only the client can release funds for this project');
    }
    if (project.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Cannot complete a project in status ${project.status}`);
    }
    const updated = await this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.COMPLETED, completedAt: new Date() },
    });
    await this.scoreEngine.recalculate(project.providerId);

    // Best-effort upsell — see MaintenanceService.activateIfEligible for why
    // this never throws back into the completion flow.
    await this.maintenanceService.activateIfEligible(updated.id);

    return updated;
  }

  /** Either party opens a dispute on a funded project. */
  async dispute(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (![project.clientId, project.providerId].includes(userId)) {
      throw new ForbiddenException('You are not a participant in this project');
    }
    if (project.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Cannot dispute a project in status ${project.status}`);
    }
    const updated = await this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.DISPUTED, disputedAt: new Date() },
    });
    await this.scoreEngine.recalculate(project.providerId);
    return updated;
  }

  /** Client cancels before funding — no money has moved yet. */
  async cancel(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (project.clientId !== userId) {
      throw new ForbiddenException('Only the client can cancel this project');
    }
    if (project.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(`Cannot cancel a project in status ${project.status}`);
    }
    const updated = await this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.CANCELED },
    });
    await this.scoreEngine.recalculate(project.providerId);
    return updated;
  }

  /** Refunds a funded, disputed project back to the client (dispute resolution). */
  async refund(escrowId: string, userId: string) {
    const project = await this.findById(escrowId);
    if (![project.clientId, project.providerId].includes(userId)) {
      throw new ForbiddenException('You are not a participant in this project');
    }
    if (project.status !== EscrowStatus.DISPUTED) {
      throw new BadRequestException('Only disputed projects can be refunded');
    }
    const updated = await this.prisma.escrowProject.update({
      where: { id: escrowId },
      data: { status: EscrowStatus.REFUNDED },
    });
    await this.scoreEngine.recalculate(project.providerId);
    return updated;
  }
}
