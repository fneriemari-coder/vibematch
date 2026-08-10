import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { EscrowStatus, PaymentModel, Prisma, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FinanceProjectDto } from './dto/finance-project.dto';
import { ConnectService } from './connect.service';

const INSTALLMENT_INTERVAL_DAYS = 30;

interface CreditDecision {
  approved: boolean;
  reason: string;
}

/**
 * Corporate BNPL engine: the client finances the project over N installments
 * while the provider is paid (minus a risk fee) the moment financing is
 * approved — the platform, not the provider, carries the collection risk.
 *
 * This is the highest-blast-radius transaction in the app (real money moves
 * immediately, before the client has paid anything), so every step is
 * either inside a DB transaction or wrapped with explicit, loud logging —
 * nothing here is allowed to fail silently.
 */
@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);
  private readonly stripe: Stripe;
  private readonly riskFeeRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connectService: ConnectService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
    this.riskFeeRate = Number(this.config.get('BNPL_RISK_FEE_RATE') ?? '0.05');
  }

  async financeProject(requesterId: string, dto: FinanceProjectDto) {
    const project = await this.prisma.escrowProject.findUnique({
      where: { id: dto.escrowProjectId },
      include: { client: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.clientId !== requesterId) {
      throw new ForbiddenException('Only the contracting client can request financing for this project');
    }
    if (project.paymentModel === PaymentModel.BNPL_FINANCED) {
      throw new BadRequestException('This project is already BNPL-financed');
    }
    const financeableStatuses: EscrowStatus[] = [EscrowStatus.PENDING, EscrowStatus.FUNDED];
    if (!financeableStatuses.includes(project.status)) {
      throw new BadRequestException(`Cannot finance a project in status ${project.status}`);
    }

    const decision = await this.evaluateClientCredit(project.clientId, Number(project.budget));
    if (!decision.approved) {
      this.logger.warn(`BNPL declined for client ${project.clientId} on project ${project.id}: ${decision.reason}`);
      throw new BadRequestException(`Financing declined: ${decision.reason}`);
    }

    const installmentCount = dto.installmentCount ?? 4;
    const budget = Number(project.budget);
    const riskFee = budget * this.riskFeeRate;
    const netPayoutToProvider = budget - riskFee;
    const installmentAmount = Number((budget / installmentCount).toFixed(2));

    const stripeCustomerId = await this.ensureStripeCustomer(project.clientId, project.client.email);

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedProject = await tx.escrowProject.update({
        where: { id: project.id },
        data: {
          status: EscrowStatus.FUNDED,
          fundedAt: project.fundedAt ?? new Date(),
          paymentModel: PaymentModel.BNPL_FINANCED,
          installmentCount,
        },
      });

      await tx.walletTransaction.create({
        data: {
          userId: project.providerId,
          type: WalletTransactionType.BNPL_FUNDING,
          amount: new Prisma.Decimal(netPayoutToProvider),
          currency: project.currency,
          relatedEscrowId: project.id,
          metadata: { grossBudget: budget, riskFeeRate: this.riskFeeRate, riskFee, installmentCount },
        },
      });

      await tx.user.update({
        where: { id: project.providerId },
        data: { walletBalance: { increment: new Prisma.Decimal(netPayoutToProvider) } },
      });

      const installments = await Promise.all(
        Array.from({ length: installmentCount }, (_, i) =>
          tx.bnplInstallment.create({
            data: {
              escrowProjectId: project.id,
              installmentNumber: i + 1,
              amount: new Prisma.Decimal(installmentAmount),
              currency: project.currency,
              dueDate: new Date(Date.now() + (i + 1) * INSTALLMENT_INTERVAL_DAYS * 24 * 60 * 60 * 1000),
            },
          }),
        ),
      );

      return { updatedProject, installments };
    });

    const { stripeTransferId } = await this.connectService.payoutOrLedgerOnly(
      project.providerId,
      netPayoutToProvider,
      project.currency,
      { kind: 'bnpl_funding', projectId: project.id },
    );

    this.logger.log(
      `BNPL approved: project ${project.id} — provider paid ${netPayoutToProvider} ${project.currency} ` +
        `now (fee ${riskFee}), client ${stripeCustomerId} scheduled for ${installmentCount} installments of ${installmentAmount}` +
        (stripeTransferId ? ` — real transfer ${stripeTransferId}` : ' — ledger only, Connect not onboarded'),
    );

    return {
      projectId: result.updatedProject.id,
      status: result.updatedProject.status,
      netPayoutToProvider,
      riskFee,
      riskFeeRate: this.riskFeeRate,
      installments: result.installments,
      realTransfer: Boolean(stripeTransferId),
    };
  }

  /**
   * Credit heuristic for the CONTRACTING CLIENT (not the provider — that's
   * ScoreEngine's job). There's no dedicated client-credit model yet, so this
   * reads directly off the client's own escrow history as clientId:
   *   - Any prior DISPUTED/CANCELED project as this client => declined.
   *   - No history at all (first project on the platform) => approved only
   *     under a conservative cap, since there's nothing to underwrite against.
   *   - Otherwise (at least one COMPLETED project, no disputes/cancellations)
   *     => approved.
   */
  private async evaluateClientCredit(clientId: string, budget: number): Promise<CreditDecision> {
    const FIRST_TIME_CLIENT_CAP = 5_000;

    const history = await this.prisma.escrowProject.findMany({
      where: { clientId, status: { in: [EscrowStatus.COMPLETED, EscrowStatus.DISPUTED, EscrowStatus.CANCELED] } },
      select: { status: true },
    });

    const hasNegativeHistory = history.some(
      (p) => p.status === EscrowStatus.DISPUTED || p.status === EscrowStatus.CANCELED,
    );
    if (hasNegativeHistory) {
      return { approved: false, reason: 'Client has a disputed or canceled project on record' };
    }

    if (history.length === 0) {
      if (budget > FIRST_TIME_CLIENT_CAP) {
        return {
          approved: false,
          reason: `First-time clients are capped at ${FIRST_TIME_CLIENT_CAP} for BNPL financing`,
        };
      }
      return { approved: true, reason: 'First-time client within cap' };
    }

    return { approved: true, reason: `${history.length} completed project(s), no disputes/cancellations` };
  }

  private async ensureStripeCustomer(clientId: string, email: string): Promise<string> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId: clientId } });
    if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;

    const customer = await this.stripe.customers.create({ email, metadata: { userId: clientId } });
    await this.prisma.subscription.upsert({
      where: { userId: clientId },
      update: { stripeCustomerId: customer.id },
      create: { userId: clientId, stripeCustomerId: customer.id },
    });
    return customer.id;
  }
}
