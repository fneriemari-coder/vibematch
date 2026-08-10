import { Injectable, Logger } from '@nestjs/common';
import { EscrowStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * "Provider Score" engine — MatchService's internal credit-scoring model.
 *
 * Produces `ProviderScore.financialHealthScore`, an integer 0-1000 blended from
 * four weighted signals, recalculated every time a project tied to the
 * provider reaches a terminal state (COMPLETED, CANCELED, DISPUTED, REFUNDED).
 *
 * Weights (must sum to 1.0 — enforced by the assertion below so a future edit
 * that changes one weight without touching the others fails loudly in CI/tests
 * rather than silently shipping a miscalibrated score):
 *   - Project cancellation rate  : 35%
 *   - Chat response time         : 25%
 *   - Client star ratings        : 30%
 *   - 90-day transaction volume  : 10%
 */
@Injectable()
export class ScoreEngine {
  private readonly logger = new Logger(ScoreEngine.name);

  private static readonly WEIGHTS = {
    cancellation: 0.35,
    responseTime: 0.25,
    rating: 0.3,
    volume: 0.1,
  } as const;

  // Response time beyond this many minutes floors the response-time sub-score at 0.
  // 120 min (2h) is the "reasonable to expect a reply" ceiling for a marketplace chat.
  private static readonly RESPONSE_TIME_CAP_MINUTES = 120;

  // 90-day transacted volume at/above this floors the volume sub-score at 1.0.
  // Chosen as a round, currency-agnostic MVP baseline; revisit once real
  // transaction-volume distributions exist.
  private static readonly TARGET_90D_VOLUME = 10_000;

  private static readonly TERMINAL_STATUSES: EscrowStatus[] = [
    EscrowStatus.COMPLETED,
    EscrowStatus.CANCELED,
    EscrowStatus.DISPUTED,
    EscrowStatus.REFUNDED,
  ];

  constructor(private readonly prisma: PrismaService) {
    const total = Object.values(ScoreEngine.WEIGHTS).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 1e-9) {
      throw new Error(`ScoreEngine weights must sum to 1.0, got ${total}`);
    }
  }

  /**
   * Recalculates and persists the provider's financial_health_score.
   * Call this after any EscrowProject belonging to the provider changes status.
   */
  async recalculate(providerId: string): Promise<number> {
    const [terminalProjects, ratingAgg, avgResponseTime, recentVolume] = await Promise.all([
      this.prisma.escrowProject.findMany({
        where: { providerId, status: { in: ScoreEngine.TERMINAL_STATUSES } },
        select: { status: true },
      }),
      this.prisma.userProfile.findUnique({
        where: { userId: providerId },
        select: { averageRating: true },
      }),
      this.averageResponseTimeMinutes(providerId),
      this.transactedVolumeLast90Days(providerId),
    ]);

    const completedCount = terminalProjects.filter(
      (p) => p.status === EscrowStatus.COMPLETED,
    ).length;
    const cancelledCount = terminalProjects.filter(
      (p) => p.status === EscrowStatus.CANCELED || p.status === EscrowStatus.DISPUTED,
    ).length;

    const reliabilityRate = this.safeRate(completedCount, completedCount + cancelledCount);
    const responseScore = this.clamp01(
      1 - avgResponseTime / ScoreEngine.RESPONSE_TIME_CAP_MINUTES,
    );
    const ratingScore = this.clamp01((ratingAgg?.averageRating ?? 0) / 5);
    const volumeScore = this.clamp01(recentVolume / ScoreEngine.TARGET_90D_VOLUME);

    const blended =
      reliabilityRate * ScoreEngine.WEIGHTS.cancellation +
      responseScore * ScoreEngine.WEIGHTS.responseTime +
      ratingScore * ScoreEngine.WEIGHTS.rating +
      volumeScore * ScoreEngine.WEIGHTS.volume;

    const financialHealthScore = Math.round(this.clamp01(blended) * 1000);

    // Snapshot the score being replaced (not the incoming one) so
    // anti-fraud.guard.ts can compute a same-provider 48h delta later —
    // this is intentionally a single previous value, not a full history.
    const existing = await this.prisma.providerScore.findUnique({ where: { providerId } });

    await this.prisma.providerScore.upsert({
      where: { providerId },
      create: {
        providerId,
        reliabilityRate,
        responseTimeMinutes: avgResponseTime,
        completedJobsCount: completedCount,
        financialHealthScore,
      },
      update: {
        reliabilityRate,
        responseTimeMinutes: avgResponseTime,
        completedJobsCount: completedCount,
        financialHealthScore,
        previousFinancialHealthScore: existing?.financialHealthScore,
        previousScoreAt: existing?.updatedAt,
      },
    });

    this.logger.log(
      `Recalculated score for provider ${providerId}: ${financialHealthScore}/1000 ` +
        `(reliability=${reliabilityRate.toFixed(2)}, response=${responseScore.toFixed(2)}, ` +
        `rating=${ratingScore.toFixed(2)}, volume=${volumeScore.toFixed(2)})`,
    );

    return financialHealthScore;
  }

  /**
   * Average minutes between a client's chat message and the provider's next
   * reply, across the provider's matches. MVP approximation: walks messages
   * per match in chronological order and averages gaps where sender flips
   * from a non-provider to the provider.
   */
  private async averageResponseTimeMinutes(providerId: string): Promise<number> {
    const matches = await this.prisma.match.findMany({
      where: { OR: [{ userOneId: providerId }, { userTwoId: providerId }] },
      select: {
        chatMessages: {
          orderBy: { createdAt: 'asc' },
          select: { senderId: true, createdAt: true },
        },
      },
    });

    const gapsMinutes: number[] = [];
    for (const match of matches) {
      const messages = match.chatMessages;
      for (let i = 1; i < messages.length; i++) {
        const prev = messages[i - 1];
        const curr = messages[i];
        if (prev.senderId !== providerId && curr.senderId === providerId) {
          const minutes = (curr.createdAt.getTime() - prev.createdAt.getTime()) / 60_000;
          gapsMinutes.push(minutes);
        }
      }
    }

    if (gapsMinutes.length === 0) {
      // No chat history yet — neutral-ish assumption rather than punishing a
      // brand-new provider with a zero score on this sub-component.
      return ScoreEngine.RESPONSE_TIME_CAP_MINUTES / 2;
    }
    return gapsMinutes.reduce((a, b) => a + b, 0) / gapsMinutes.length;
  }

  private async transactedVolumeLast90Days(providerId: string): Promise<number> {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.escrowProject.aggregate({
      where: { providerId, status: EscrowStatus.COMPLETED, completedAt: { gte: since } },
      _sum: { budget: true },
    });
    return Number(result._sum.budget ?? 0);
  }

  private safeRate(numerator: number, denominator: number): number {
    // A provider with zero terminal projects hasn't proven anything either
    // way — default to a neutral 0.7 rather than 0 (which would read as
    // "100% cancellation rate") or 1 (which would read as "perfect record").
    if (denominator === 0) return 0.7;
    return numerator / denominator;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
