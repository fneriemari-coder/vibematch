import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EscrowStatus, MatchType, MilestoneStatus, Prisma } from '@prisma/client';
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

  /**
   * Internal lookup — no authorization. Callers that serve a request must use
   * `findByIdForUser`; this one exists for the state transitions below, which
   * do their own participant checks.
   */
  async findById(id: string) {
    const project = await this.prisma.escrowProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Escrow project not found');
    return project;
  }

  /**
   * The authorized read. `GET /escrow/:id` previously called `findById`
   * directly, so any authenticated user could read any project's client,
   * provider, budget and status by guessing an id — the commercial terms of
   * other people's deals.
   */
  async findByIdForUser(id: string, userId: string) {
    const project = await this.findById(id);
    if (project.clientId !== userId && project.providerId !== userId) {
      throw new ForbiddenException('You are not a participant in this project');
    }
    return project;
  }

  /**
   * The caller's projects, newest first.
   *
   * Returns the counterpart's name and the milestone tally alongside each
   * project. The bare rows this used to return were unrenderable — a list of
   * uuids and amounts with no indication of who the deal is with or how far
   * along it is — and resolving that client-side would have meant one request
   * per project.
   */
  async listForUser(userId: string) {
    const projects = await this.prisma.escrowProject.findMany({
      where: { OR: [{ clientId: userId }, { providerId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, profile: { select: { name: true } } } },
        provider: { select: { id: true, profile: { select: { name: true } } } },
        milestones: { select: { status: true } },
      },
    });

    return projects.map((project) => {
      const isClient = project.clientId === userId;
      const counterpart = isClient ? project.provider : project.client;
      return {
        id: project.id,
        matchId: project.matchId,
        status: project.status,
        budget: project.budget,
        currency: project.currency,
        paymentModel: project.paymentModel,
        installmentCount: project.installmentCount,
        advanced: project.advanced,
        role: isClient ? 'CLIENT' : 'PROVIDER',
        counterpartId: counterpart.id,
        counterpartName: counterpart.profile?.name ?? 'Usuário',
        milestoneTotal: project.milestones.length,
        milestoneApproved: project.milestones.filter((m) => m.status === MilestoneStatus.APPROVED)
          .length,
        createdAt: project.createdAt,
        fundedAt: project.fundedAt,
        completedAt: project.completedAt,
        disputedAt: project.disputedAt,
      };
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
