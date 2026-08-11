import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LazyOpenAI } from '../../common/ai/lazy-openai';
// Type-only: runAudit assembles a multi-part vision payload and needs the
// SDK's ChatCompletionContentPart shape. Erased at compile time, so it does
// not reintroduce a client construction at boot.
import type OpenAI from 'openai';
import { EscrowStatus, MilestoneStatus, Prisma, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScoreEngine } from '../users/score.engine';
import { MaintenanceService } from '../fintech/maintenance.service';
import { VerifyMilestoneDto } from './dto/verify-milestone.dto';

interface AuditVerdict {
  complianceScore: number;
  isApproved: boolean;
  feedback: string;
}

const AUDIT_JSON_SCHEMA = {
  name: 'milestone_delivery_audit',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      complianceScore: {
        type: 'integer',
        description: '0-100 rigor score against the milestone criteria — 100 means the deliverable fully satisfies every stated requirement.',
      },
      isApproved: {
        type: 'boolean',
        description: 'TRUE only if complianceScore reflects a genuinely complete, contract-satisfying delivery.',
      },
      feedback: {
        type: 'string',
        description: 'Specific, actionable audit notes — what was verified, what (if anything) is missing or non-compliant.',
      },
    },
    required: ['complianceScore', 'isApproved', 'feedback'],
    additionalProperties: false,
  },
} as const;

/**
 * AI Delivery Validator — a technical auditor with the authority to release
 * escrowed funds without a human (client) in the loop. Given that authority,
 * every path here either fully commits (milestone APPROVED + wallet
 * credited, atomically) or fully reverts (milestone back to PENDING, error
 * logged) — there is no partial state a retry could double-pay from.
 */
@Injectable()
export class AiValidatorService {
  private readonly logger = new Logger(AiValidatorService.name);
  private readonly openai: LazyOpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoreEngine: ScoreEngine,
    private readonly maintenanceService: MaintenanceService,
    private readonly config: ConfigService,
  ) {
    this.openai = new LazyOpenAI(this.config.get('OPENAI_API_KEY'), this.logger, 'milestone validation');
  }

  async verifyMilestone(requesterId: string, dto: VerifyMilestoneDto) {
    const milestone = await this.prisma.projectMilestone.findUnique({
      where: { id: dto.milestoneId },
      include: { project: true },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    if (milestone.project.providerId !== requesterId) {
      throw new ForbiddenException('Only the assigned provider can submit this milestone for verification');
    }
    if (milestone.status === MilestoneStatus.APPROVED) {
      throw new BadRequestException('Milestone already approved');
    }
    if (milestone.project.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Project must be FUNDED to verify milestones (currently ${milestone.project.status})`);
    }

    await this.prisma.projectMilestone.update({
      where: { id: milestone.id },
      data: { status: MilestoneStatus.VERIFYING },
    });

    let verdict: AuditVerdict;
    try {
      verdict = await this.runAudit(milestone.criteriaDescription, dto);
    } catch (err) {
      this.logger.error(`Audit call failed for milestone ${milestone.id}: ${(err as Error).message}`);
      await this.appendLog(milestone.id, `Audit failed (service error): ${(err as Error).message}`);
      // Revert to PENDING rather than leaving it stuck in VERIFYING — the
      // provider can safely resubmit.
      await this.prisma.projectMilestone.update({
        where: { id: milestone.id },
        data: { status: MilestoneStatus.PENDING },
      });
      throw new BadRequestException('AI audit service unavailable — please try again shortly');
    }

    await this.appendLog(
      milestone.id,
      `Score ${verdict.complianceScore}/100 — ${verdict.isApproved ? 'APPROVED' : 'REJECTED'} — ${verdict.feedback}`,
    );

    if (!verdict.isApproved) {
      await this.prisma.projectMilestone.update({
        where: { id: milestone.id },
        data: { status: MilestoneStatus.PENDING },
      });
      return { ...verdict, milestoneStatus: MilestoneStatus.PENDING };
    }

    await this.releaseMilestoneFunds(milestone.id, milestone.projectId);
    return { ...verdict, milestoneStatus: MilestoneStatus.APPROVED };
  }

  private async runAudit(criteriaDescription: string, dto: VerifyMilestoneDto): Promise<AuditVerdict> {
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text:
          `Contract milestone criteria:\n${criteriaDescription}\n\n` +
          `Provider's delivery notes:\n${dto.deliverableText ?? '(no text notes — see attached file/link)'}`,
      },
    ];
    if (dto.deliverableUrl) {
      // Best-effort: works as vision input for image URLs; for non-image
      // links GPT-4o still receives the URL as context inside the text block
      // above, so the audit degrades gracefully rather than failing.
      userContent.push({ type: 'image_url', image_url: { url: dto.deliverableUrl } });
    }

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: AUDIT_JSON_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            'You are a rigorous technical delivery auditor for a services marketplace escrow system. ' +
            'Compare the submitted deliverable strictly against the milestone criteria below. Be skeptical: ' +
            'only approve (isApproved=true) when the deliverable genuinely, verifiably satisfies the contract. ' +
            'Approving unearned work releases real money with no human review — err toward rejecting ambiguous cases.',
        },
        { role: 'user', content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty completion from OpenAI');
    return JSON.parse(raw) as AuditVerdict;
  }

  /**
   * Approves the milestone and releases its share of the project budget to
   * the provider's wallet in one transaction. If every milestone on the
   * project is now APPROVED, the project itself is marked COMPLETED and the
   * provider's score is recalculated — mirroring EscrowService.complete(),
   * just triggered by the AI audit instead of a manual client action.
   */
  private async releaseMilestoneFunds(milestoneId: string, projectId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const milestone = await tx.projectMilestone.findUniqueOrThrow({ where: { id: milestoneId } });
      const project = await tx.escrowProject.findUniqueOrThrow({ where: { id: projectId } });
      const allMilestones = await tx.projectMilestone.findMany({ where: { projectId } });

      const releaseAmount =
        milestone.releaseAmount !== null
          ? Number(milestone.releaseAmount)
          : Number(project.budget) / Math.max(allMilestones.length, 1);

      await tx.projectMilestone.update({
        where: { id: milestoneId },
        data: { status: MilestoneStatus.APPROVED, releaseAmount: new Prisma.Decimal(releaseAmount) },
      });

      await tx.walletTransaction.create({
        data: {
          userId: project.providerId,
          type: WalletTransactionType.MILESTONE_RELEASE,
          amount: new Prisma.Decimal(releaseAmount),
          currency: project.currency,
          relatedEscrowId: project.id,
          metadata: { milestoneId },
        },
      });

      await tx.user.update({
        where: { id: project.providerId },
        data: { walletBalance: { increment: new Prisma.Decimal(releaseAmount) } },
      });

      const stillPending = allMilestones.some((m) => m.id !== milestoneId && m.status !== MilestoneStatus.APPROVED);
      if (!stillPending) {
        await tx.escrowProject.update({
          where: { id: projectId },
          data: { status: EscrowStatus.COMPLETED, completedAt: new Date() },
        });
      }
    });

    const project = await this.prisma.escrowProject.findUniqueOrThrow({ where: { id: projectId } });
    if (project.status === EscrowStatus.COMPLETED) {
      await this.scoreEngine.recalculate(project.providerId);
      await this.maintenanceService.activateIfEligible(project.id);
    }

    this.logger.log(`Milestone ${milestoneId} AI-approved and funds released for project ${projectId}`);
  }

  private async appendLog(milestoneId: string, entry: string): Promise<void> {
    const milestone = await this.prisma.projectMilestone.findUnique({ where: { id: milestoneId } });
    const line = `[${new Date().toISOString()}] ${entry}`;
    await this.prisma.projectMilestone.update({
      where: { id: milestoneId },
      data: { aiFeedbackLog: milestone?.aiFeedbackLog ? `${milestone.aiFeedbackLog}\n${line}` : line },
    });
  }
}
