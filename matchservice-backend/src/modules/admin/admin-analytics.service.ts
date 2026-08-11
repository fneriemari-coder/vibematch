import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  Currency,
  EscrowStatus,
  InstallmentStatus,
  MatchStatus,
  Prisma,
  SubscriptionStatus,
  SubscriptionTier,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MetricsPeriod } from './dto/dashboard-metrics-query.dto';

const CURRENCIES: Currency[] = [Currency.USD, Currency.BRL];

// Both PREMIUM_CLIENT and PRO_PROVIDER are flat-priced per currency (matches
// the Flutter paywall screen: $49/mo USD, R$149/mo BRL) — there's no
// per-tier price stored on Subscription itself, so MRR is derived from this
// constant rather than summed from real invoice amounts. Override via env
// if pricing ever diverges by tier.
const DEFAULT_SUBSCRIPTION_PRICE: Record<Currency, number> = { USD: 49, BRL: 149 };

/**
 * All figures are aggregated live from Prisma — nothing here is cached or
 * pre-materialized, so this is a read-heavy endpoint by design (acceptable
 * for an admin-only, low-QPS dashboard; would need a summary table if this
 * ever needs to serve high traffic). Everywhere a date range applies, the
 * underlying models are already indexed on `createdAt` (see schema.prisma)
 * except the ledger-fee breakdown, which reduces WalletTransaction.metadata
 * in application code — noted inline, since JSON fields can't be
 * server-side SUM'd.
 */
@Injectable()
export class AdminAnalyticsService {
  private readonly subscriptionPrice: Record<Currency, number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.subscriptionPrice = {
      USD: Number(this.config.get('SUBSCRIPTION_PRICE_USD') ?? DEFAULT_SUBSCRIPTION_PRICE.USD),
      BRL: Number(this.config.get('SUBSCRIPTION_PRICE_BRL') ?? DEFAULT_SUBSCRIPTION_PRICE.BRL),
    };
  }

  async getDashboardMetrics(period: MetricsPeriod = '30d') {
    const since = this.periodToDate(period);

    const [financial, liquidity] = await Promise.all([
      this.getFinancialMetrics(since),
      this.getLiquidityMetrics(since),
    ]);

    return { period, since, financial, liquidity };
  }

  // ---------------------------------------------------------------------
  // 1. Financial metrics
  // ---------------------------------------------------------------------

  private async getFinancialMetrics(since: Date) {
    const [mrr, gmv, netRevenue, churn] = await Promise.all([
      this.getMrr(),
      this.getGmv(since),
      this.getPlatformNetRevenue(since),
      this.getChurn(since),
    ]);
    return { mrr, gmv, netRevenue, churn };
  }

  private async getMrr(): Promise<Record<Currency, number>> {
    const rows = await this.prisma.subscription.groupBy({
      by: ['currency'],
      where: { status: SubscriptionStatus.ACTIVE, tier: { in: [SubscriptionTier.PREMIUM_CLIENT, SubscriptionTier.PRO_PROVIDER] } },
      _count: { _all: true },
    });

    const result: Record<Currency, number> = { USD: 0, BRL: 0 };
    for (const row of rows) {
      result[row.currency] = row._count._all * this.subscriptionPrice[row.currency];
    }
    return result;
  }

  private async getGmv(since: Date): Promise<Record<Currency, number>> {
    const rows = await this.prisma.escrowProject.groupBy({
      by: ['currency'],
      where: { status: { in: [EscrowStatus.FUNDED, EscrowStatus.COMPLETED] }, createdAt: { gte: since } },
      _sum: { budget: true },
    });

    const result: Record<Currency, number> = { USD: 0, BRL: 0 };
    for (const row of rows) {
      result[row.currency] = Number(row._sum.budget ?? 0);
    }
    return result;
  }

  /**
   * Sums four take-rate streams by currency:
   *   - Escrow: REAL platform share, from ESCROW_RELEASE metadata.platformShare
   *   - Receivables advance: REAL fee amount, from WalletTransaction.metadata.fee
   *   - BNPL funding: REAL risk fee, from metadata.riskFee
   *   - Maintenance + Course revenue: REAL platform share, from metadata.platformShare
   */
  private async getPlatformNetRevenue(since: Date) {
    // Escrow used to be estimated as `completed GMV × rate`, which is now
    // wrong in two directions. EscrowService.complete() charges a real fee and
    // records the platform's cut on the ESCROW_RELEASE row, and it nets off
    // anything already paid out for the project (an advanced or BNPL-funded
    // project releases only the top-up, or nothing). Multiplying full budgets
    // therefore overstated revenue for exactly the projects that earned the
    // most fees elsewhere. Read the ledger instead, the same way every other
    // line here already does.
    const feeTransactions = await this.prisma.walletTransaction.findMany({
      where: {
        type: {
          in: [
            WalletTransactionType.ESCROW_RELEASE,
            WalletTransactionType.ADVANCE,
            WalletTransactionType.BNPL_FUNDING,
            WalletTransactionType.MAINTENANCE_REVENUE,
            WalletTransactionType.COURSE_REVENUE,
          ],
        },
        createdAt: { gte: since },
      },
      select: { type: true, currency: true, metadata: true },
    });

    const revenue: Record<Currency, { escrow: number; advance: number; bnpl: number; maintenance: number; course: number; total: number }> = {
      USD: { escrow: 0, advance: 0, bnpl: 0, maintenance: 0, course: 0, total: 0 },
      BRL: { escrow: 0, advance: 0, bnpl: 0, maintenance: 0, course: 0, total: 0 },
    };

    for (const tx of feeTransactions) {
      const metadata = (tx.metadata ?? {}) as Record<string, unknown>;
      const bucket = revenue[tx.currency];
      switch (tx.type) {
        case WalletTransactionType.ESCROW_RELEASE:
          bucket.escrow += Number(metadata.platformShare ?? 0);
          break;
        case WalletTransactionType.ADVANCE:
          bucket.advance += Number(metadata.fee ?? 0);
          break;
        case WalletTransactionType.BNPL_FUNDING:
          bucket.bnpl += Number(metadata.riskFee ?? 0);
          break;
        case WalletTransactionType.MAINTENANCE_REVENUE:
          bucket.maintenance += Number(metadata.platformShare ?? 0);
          break;
        case WalletTransactionType.COURSE_REVENUE:
          bucket.course += Number(metadata.platformShare ?? 0);
          break;
      }
    }

    for (const currency of CURRENCIES) {
      const b = revenue[currency];
      b.total = b.escrow + b.advance + b.bnpl + b.maintenance + b.course;
    }

    return revenue;
  }

  private async getChurn(since: Date) {
    const [subscriptionCounts, bnplCounts] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['status'],
        where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
        _count: { _all: true },
      }),
      this.prisma.bnplInstallment.groupBy({
        by: ['status'],
        where: { dueDate: { gte: since }, status: { in: [InstallmentStatus.CHARGED, InstallmentStatus.FAILED] } },
        _count: { _all: true },
      }),
    ]);

    const active = subscriptionCounts.find((r) => r.status === SubscriptionStatus.ACTIVE)?._count._all ?? 0;
    const pastDue = subscriptionCounts.find((r) => r.status === SubscriptionStatus.PAST_DUE)?._count._all ?? 0;
    const subscriptionPastDueRate = active + pastDue > 0 ? Number((pastDue / (active + pastDue) * 100).toFixed(2)) : 0;

    const charged = bnplCounts.find((r) => r.status === InstallmentStatus.CHARGED)?._count._all ?? 0;
    const failed = bnplCounts.find((r) => r.status === InstallmentStatus.FAILED)?._count._all ?? 0;
    const bnplFailureRate = charged + failed > 0 ? Number((failed / (charged + failed) * 100).toFixed(2)) : 0;

    return { subscriptionPastDueRatePercent: subscriptionPastDueRate, bnplInstallmentFailureRatePercent: bnplFailureRate };
  }

  // ---------------------------------------------------------------------
  // 2. Marketplace liquidity / health
  // ---------------------------------------------------------------------

  private async getLiquidityMetrics(since: Date) {
    const [activeMatches, completedProjects, avgTimeToMatchSeconds, scoreStats, underReviewCount] = await Promise.all([
      this.prisma.match.count({ where: { status: MatchStatus.ACTIVE } }),
      this.prisma.escrowProject.count({ where: { status: EscrowStatus.COMPLETED, completedAt: { gte: since } } }),
      this.getAvgTimeToMatchSeconds(since),
      this.prisma.providerScore.aggregate({ _avg: { financialHealthScore: true } }),
      this.prisma.user.count({ where: { accountStatus: AccountStatus.UNDER_REVIEW } }),
    ]);

    const anomalyCount = await this.prisma.providerScore.count({ where: { financialHealthScore: { lt: 300 } } });

    return {
      activeMatches,
      completedProjects,
      avgTimeToMatchSeconds,
      avgKScore: Math.round(scoreStats._avg.financialHealthScore ?? 0),
      lowScoreProviderCount: anomalyCount,
      accountsUnderReview: underReviewCount,
    };
  }

  /**
   * Average seconds between a match's first reciprocal LIKE and Match.createdAt.
   * Uses a LATERAL join so Postgres computes the earliest qualifying swipe
   * per match server-side rather than N+1 round trips from the app.
   */
  private async getAvgTimeToMatchSeconds(since: Date): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ avg_seconds: number | null }>>(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - first_like.first_like_at))) AS avg_seconds
      FROM matches m
      JOIN LATERAL (
        SELECT MIN(s.created_at) AS first_like_at
        FROM swipes s
        WHERE s.direction = 'LIKE'
          AND ((s.swiper_id = m.user_one_id AND s.swiped_id = m.user_two_id)
            OR (s.swiper_id = m.user_two_id AND s.swiped_id = m.user_one_id))
      ) first_like ON true
      WHERE m.created_at >= ${since};
    `);
    return Math.round(Number(result[0]?.avg_seconds ?? 0));
  }

  private periodToDate(period: MetricsPeriod): Date {
    const days = period === '7d' ? 7 : period === 'quarter' ? 90 : 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
}
