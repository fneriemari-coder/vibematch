enum MetricsPeriod { d7, d30, quarter }

extension MetricsPeriodApi on MetricsPeriod {
  String get apiValue => switch (this) {
        MetricsPeriod.d7 => '7d',
        MetricsPeriod.d30 => '30d',
        MetricsPeriod.quarter => 'quarter',
      };

  String get label => switch (this) {
        MetricsPeriod.d7 => '7 dias',
        MetricsPeriod.d30 => '30 dias',
        MetricsPeriod.quarter => 'Trimestre',
      };
}

class CurrencyAmounts {
  const CurrencyAmounts({required this.usd, required this.brl});

  final double usd;
  final double brl;

  factory CurrencyAmounts.fromJson(Map<String, dynamic> json) =>
      CurrencyAmounts(
        usd: (json['USD'] as num?)?.toDouble() ?? 0,
        brl: (json['BRL'] as num?)?.toDouble() ?? 0,
      );
}

class RevenueBreakdown {
  const RevenueBreakdown({
    required this.escrow,
    required this.advance,
    required this.bnpl,
    required this.maintenance,
    required this.course,
    required this.total,
  });

  /// The platform's real cut of completed contracts, summed from the
  /// ESCROW_RELEASE ledger rows. It used to be an estimate of completed GMV
  /// times a nominal rate, which overstated exactly the projects that had
  /// already paid out through an advance or BNPL.
  final double escrow;
  final double advance;
  final double bnpl;
  final double maintenance;
  final double course;
  final double total;

  factory RevenueBreakdown.fromJson(Map<String, dynamic> json) =>
      RevenueBreakdown(
        escrow: (json['escrow'] as num?)?.toDouble() ?? 0,
        advance: (json['advance'] as num?)?.toDouble() ?? 0,
        bnpl: (json['bnpl'] as num?)?.toDouble() ?? 0,
        maintenance: (json['maintenance'] as num?)?.toDouble() ?? 0,
        course: (json['course'] as num?)?.toDouble() ?? 0,
        total: (json['total'] as num?)?.toDouble() ?? 0,
      );
}

class ChurnMetrics {
  const ChurnMetrics({
    required this.subscriptionPastDueRatePercent,
    required this.bnplInstallmentFailureRatePercent,
  });

  final double subscriptionPastDueRatePercent;
  final double bnplInstallmentFailureRatePercent;

  factory ChurnMetrics.fromJson(Map<String, dynamic> json) => ChurnMetrics(
        subscriptionPastDueRatePercent:
            (json['subscriptionPastDueRatePercent'] as num?)?.toDouble() ?? 0,
        bnplInstallmentFailureRatePercent:
            (json['bnplInstallmentFailureRatePercent'] as num?)?.toDouble() ??
                0,
      );
}

class LiquidityMetrics {
  const LiquidityMetrics({
    required this.activeMatches,
    required this.completedProjects,
    required this.avgTimeToMatchSeconds,
    required this.avgKScore,
    required this.lowScoreProviderCount,
    required this.accountsUnderReview,
  });

  final int activeMatches;
  final int completedProjects;
  final int avgTimeToMatchSeconds;
  final int avgKScore;
  final int lowScoreProviderCount;
  final int accountsUnderReview;

  factory LiquidityMetrics.fromJson(Map<String, dynamic> json) =>
      LiquidityMetrics(
        activeMatches: json['activeMatches'] as int? ?? 0,
        completedProjects: json['completedProjects'] as int? ?? 0,
        avgTimeToMatchSeconds: json['avgTimeToMatchSeconds'] as int? ?? 0,
        avgKScore: json['avgKScore'] as int? ?? 0,
        lowScoreProviderCount: json['lowScoreProviderCount'] as int? ?? 0,
        accountsUnderReview: json['accountsUnderReview'] as int? ?? 0,
      );
}

class DashboardMetrics {
  const DashboardMetrics({
    required this.mrr,
    required this.gmv,
    required this.netRevenueUsd,
    required this.netRevenueBrl,
    required this.churn,
    required this.liquidity,
  });

  final CurrencyAmounts mrr;
  final CurrencyAmounts gmv;
  final RevenueBreakdown netRevenueUsd;
  final RevenueBreakdown netRevenueBrl;
  final ChurnMetrics churn;
  final LiquidityMetrics liquidity;

  factory DashboardMetrics.fromJson(Map<String, dynamic> json) {
    final financial = json['financial'] as Map<String, dynamic>;
    final netRevenue = financial['netRevenue'] as Map<String, dynamic>;
    return DashboardMetrics(
      mrr: CurrencyAmounts.fromJson(financial['mrr'] as Map<String, dynamic>),
      gmv: CurrencyAmounts.fromJson(financial['gmv'] as Map<String, dynamic>),
      netRevenueUsd: RevenueBreakdown.fromJson(
        netRevenue['USD'] as Map<String, dynamic>,
      ),
      netRevenueBrl: RevenueBreakdown.fromJson(
        netRevenue['BRL'] as Map<String, dynamic>,
      ),
      churn: ChurnMetrics.fromJson(financial['churn'] as Map<String, dynamic>),
      liquidity: LiquidityMetrics.fromJson(
        json['liquidity'] as Map<String, dynamic>,
      ),
    );
  }
}
