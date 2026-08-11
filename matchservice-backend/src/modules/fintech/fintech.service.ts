import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Currency, EscrowStatus, Prisma, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConnectService } from './connect.service';

@Injectable()
export class FintechService {
  private readonly logger = new Logger(FintechService.name);
  private readonly advanceDiscountRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connectService: ConnectService,
  ) {
    this.advanceDiscountRate = Number(
      this.config.get('RECEIVABLES_ADVANCE_DISCOUNT_RATE') ?? '0.05',
    );
  }

  /**
   * PRO_PROVIDER receivables advance: if the project is FUNDED (client already
   * deposited, but hasn't released on completion yet), the provider can cash
   * out early at a discount. The platform assumes the final-release risk —
   * if the escrow later gets disputed/refunded, the platform eats the loss,
   * not the provider.
   */
  async advance(providerId: string, escrowId: string) {
    const project = await this.prisma.escrowProject.findUnique({ where: { id: escrowId } });
    if (!project) throw new NotFoundException('Escrow project not found');
    if (project.providerId !== providerId) {
      throw new ForbiddenException('Only the assigned provider can request an advance on this project');
    }
    if (project.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Project must be FUNDED to advance (currently ${project.status})`);
    }
    if (project.advanced) {
      throw new BadRequestException('This project has already been advanced');
    }

    const budget = Number(project.budget);
    const fee = budget * this.advanceDiscountRate;
    const netAmount = budget - fee;

    const [, , updatedUser] = await this.prisma.$transaction([
      this.prisma.escrowProject.update({
        where: { id: escrowId },
        data: { advanced: true },
      }),
      this.prisma.walletTransaction.create({
        data: {
          userId: providerId,
          type: WalletTransactionType.ADVANCE,
          amount: new Prisma.Decimal(netAmount),
          currency: project.currency,
          relatedEscrowId: escrowId,
          metadata: { grossBudget: budget, feeRate: this.advanceDiscountRate, fee },
        },
      }),
      this.prisma.user.update({
        where: { id: providerId },
        data: { walletBalance: { increment: new Prisma.Decimal(netAmount) } },
        select: { id: true, walletBalance: true },
      }),
    ]);

    // Ledger is already updated above regardless of outcome — this only
    // additionally moves real money into the provider's Connect account if
    // they've onboarded. See ConnectService.payoutOrLedgerOnly.
    const { stripeTransferId } = await this.connectService.payoutOrLedgerOnly(
      providerId,
      netAmount,
      project.currency,
      { kind: 'advance', escrowId },
    );

    this.logger.log(
      `Advanced ${netAmount} ${project.currency} to provider ${providerId} on escrow ${escrowId} (fee ${fee})` +
        (stripeTransferId ? ` — real transfer ${stripeTransferId}` : ' — ledger only, Connect not onboarded'),
    );

    return {
      escrowId,
      grossBudget: budget,
      feeRate: this.advanceDiscountRate,
      fee,
      netAmount,
      currency: project.currency,
      walletBalance: updatedUser.walletBalance,
      realTransfer: Boolean(stripeTransferId),
    };
  }

  /**
   * Withdraws from the user's wallet. If the user has completed Stripe
   * Connect onboarding, this triggers a REAL bank payout via
   * ConnectService.requestPayout (only the ledger decrements on success —
   * a failed real payout must not touch the ledger). Otherwise it falls
   * back to a ledger-only withdrawal (no real money moves) so the feature
   * still works for providers who haven't onboarded yet, without pretending
   * it paid out to a bank.
   */
  async withdraw(userId: string, amount: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const currency = user.country === 'BR' ? Currency.BRL : Currency.USD;
    const isConnected = Boolean(user.stripeConnectAccountId && user.stripeConnectPayoutsEnabled);
    const debit = new Prisma.Decimal(amount);

    // STEP 1 — reserve the funds atomically.
    //
    // This used to be a `findUnique` sufficiency check followed by an
    // UNCONDITIONAL `decrement`. Two withdrawals racing on the same wallet
    // both read the same balance, both passed the check, and both
    // decremented — driving `walletBalance` negative AFTER real Stripe
    // payouts had already left the platform account. The guard now lives in
    // the WHERE clause, so the database itself decides: exactly one of N
    // concurrent requests can match `walletBalance >= amount` and the rest
    // match zero rows.
    const reserved = await this.prisma.user.updateMany({
      where: { id: userId, walletBalance: { gte: debit } },
      data: { walletBalance: { decrement: debit } },
    });
    if (reserved.count === 0) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const ledgerEntry = await this.prisma.walletTransaction.create({
      data: {
        userId,
        type: WalletTransactionType.WITHDRAWAL,
        amount: new Prisma.Decimal(-amount),
        currency,
      },
    });

    // STEP 2 — only now attempt the real payout. Money never leaves before
    // the balance backing it has been reserved.
    let stripePayoutId: string | null = null;
    if (isConnected) {
      try {
        const payout = await this.connectService.requestPayout(userId, amount, currency);
        stripePayoutId = payout.id;
        await this.prisma.walletTransaction.update({
          where: { id: ledgerEntry.id },
          data: { metadata: { stripePayoutId } },
        });
      } catch (err) {
        // STEP 3 — compensate. The reservation already happened, so the
        // ledger would otherwise be wrong (balance debited, no payout). Undo
        // it with an explicit contra-entry rather than a silent rollback, so
        // the reversal is visible in the transaction history.
        const reason = (err as Error).message;
        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: userId },
            data: { walletBalance: { increment: debit } },
          }),
          this.prisma.walletTransaction.create({
            data: {
              userId,
              // No dedicated REVERSAL type in WalletTransactionType, so the
              // returned funds are recorded as a DEPOSIT that points back at
              // the failed withdrawal.
              type: WalletTransactionType.DEPOSIT,
              amount: new Prisma.Decimal(amount),
              currency,
              metadata: { kind: 'withdrawal_reversal', reversalOf: ledgerEntry.id, reason },
            },
          }),
        ]);

        this.logger.error(
          `Payout failed for user ${userId} (${amount} ${currency}) — reserved balance released and ` +
            `withdrawal ${ledgerEntry.id} reversed: ${reason}`,
        );
        throw err;
      }
    }

    const updatedUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { walletBalance: true },
    });

    this.logger.log(
      `Withdrawal of ${amount} ${currency} for user ${userId}` +
        (stripePayoutId ? ` — real Stripe payout ${stripePayoutId}` : ' — ledger only, Connect not onboarded'),
    );
    return { amount, currency, walletBalance: updatedUser.walletBalance, realPayout: Boolean(stripePayoutId) };
  }

  /**
   * Unified feed for the wallet dashboard's timeline: BNPL installments the
   * user owes as a client, plus milestones on any project they're a client
   * or provider on (pending AI verification / already released).
   */
  async getTimeline(userId: string) {
    const [installments, milestones] = await Promise.all([
      this.prisma.bnplInstallment.findMany({
        where: { escrowProject: { clientId: userId } },
        orderBy: { dueDate: 'asc' },
        include: { escrowProject: { select: { id: true, providerId: true, currency: true } } },
      }),
      this.prisma.projectMilestone.findMany({
        where: { project: { OR: [{ clientId: userId }, { providerId: userId }] } },
        orderBy: { createdAt: 'asc' },
        include: { project: { select: { id: true, currency: true, providerId: true, clientId: true } } },
      }),
    ]);

    return { installments, milestones };
  }
}
