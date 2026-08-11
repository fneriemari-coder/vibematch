import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/admin_metrics.dart';
import '../../data/repositories/admin_repository.dart';
import '../widgets/vibe_glass_card.dart';

/// Global Admin Dashboard — restricted to Role.ADMIN server-side (RolesGuard
/// on GET /admin/dashboard-metrics; a 403 here means the account isn't an
/// admin, not a client bug). Minimalist dark theme, fl_chart line/bar
/// visuals, period filter (7 dias / 30 dias / Trimestre).
class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key, required this.adminRepository});

  final AdminRepository adminRepository;

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  MetricsPeriod _period = MetricsPeriod.d30;
  Future<DashboardMetrics>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(
      () => _future = widget.adminRepository.getDashboardMetrics(_period),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Painel Admin'),
      ),
      body: FutureBuilder<DashboardMetrics>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(
                color: VibeMatchColors.neonPrimary,
              ),
            );
          }
          if (snapshot.hasError) {
            final isForbidden = snapshot.error.toString().contains('403');
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  isForbidden
                      ? 'Acesso restrito a administradores.'
                      : 'Erro ao carregar métricas: ${snapshot.error}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: VibeMatchColors.textLow),
                ),
              ),
            );
          }
          final metrics = snapshot.data!;
          return RefreshIndicator(
            color: VibeMatchColors.neonPrimary,
            onRefresh: () async => _load(),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _PeriodSelector(
                  selected: _period,
                  onChanged: (p) {
                    _period = p;
                    _load();
                  },
                ),
                const SizedBox(height: 20),
                _StatGrid(metrics: metrics),
                const SizedBox(height: 28),
                Text(
                  'Receita Líquida da Plataforma (USD)',
                  style: VibeMatchTextStyles.heading.copyWith(fontSize: 16),
                ),
                const SizedBox(height: 12),
                _RevenueBarChart(
                  breakdown: metrics.netRevenueUsd,
                  currencySymbol: r'$',
                ),
                const SizedBox(height: 28),
                Text(
                  'Receita Líquida da Plataforma (BRL)',
                  style: VibeMatchTextStyles.heading.copyWith(fontSize: 16),
                ),
                const SizedBox(height: 12),
                _RevenueBarChart(
                  breakdown: metrics.netRevenueBrl,
                  currencySymbol: 'R\$',
                ),
                const SizedBox(height: 28),
                Text(
                  'MRR vs GMV por moeda',
                  style: VibeMatchTextStyles.heading.copyWith(fontSize: 16),
                ),
                const SizedBox(height: 12),
                _MrrGmvChart(metrics: metrics),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PeriodSelector extends StatelessWidget {
  const _PeriodSelector({required this.selected, required this.onChanged});

  final MetricsPeriod selected;
  final ValueChanged<MetricsPeriod> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: MetricsPeriod.values.map((p) {
        final isSelected = p == selected;
        return Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Material(
              color: isSelected
                  ? VibeMatchColors.neonPrimary
                  : VibeMatchColors.surface,
              borderRadius: VibeMatchRadii.buttonRadius,
              child: InkWell(
                borderRadius: VibeMatchRadii.buttonRadius,
                onTap: () => onChanged(p),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text(
                    p.label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color:
                          isSelected ? Colors.black : VibeMatchColors.textHigh,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.metrics});

  final DashboardMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final tiles = [
      _StatTileData(
        'Matches Ativos',
        '${metrics.liquidity.activeMatches}',
        Icons.favorite,
        VibeMatchColors.neonPrimary,
      ),
      _StatTileData(
        'Projetos Concluídos',
        '${metrics.liquidity.completedProjects}',
        Icons.task_alt,
        const Color(0xFF10B981),
      ),
      _StatTileData(
        'Tempo Médio p/ Match',
        _formatDuration(metrics.liquidity.avgTimeToMatchSeconds),
        Icons.timer,
        VibeMatchColors.scoreGold,
      ),
      _StatTileData(
        'K-SCORE Médio',
        '${metrics.liquidity.avgKScore}',
        Icons.bolt,
        VibeMatchColors.scoreGold,
      ),
      _StatTileData(
        'Contas em Revisão',
        '${metrics.liquidity.accountsUnderReview}',
        Icons.shield_moon_outlined,
        const Color(0xFFEF4444),
      ),
      _StatTileData(
        'Churn Assinaturas',
        '${metrics.churn.subscriptionPastDueRatePercent.toStringAsFixed(1)}%',
        Icons.trending_down,
        const Color(0xFFEF4444),
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 1.6,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
      ),
      itemCount: tiles.length,
      itemBuilder: (context, index) => _StatTile(data: tiles[index]),
    );
  }

  String _formatDuration(int seconds) {
    if (seconds < 60) return '${seconds}s';
    if (seconds < 3600) return '${(seconds / 60).round()}min';
    return '${(seconds / 3600).toStringAsFixed(1)}h';
  }
}

class _StatTileData {
  const _StatTileData(this.label, this.value, this.icon, this.color);
  final String label;
  final String value;
  final IconData icon;
  final Color color;
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.data});
  final _StatTileData data;

  @override
  Widget build(BuildContext context) {
    return VibeGlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(data.icon, color: data.color, size: 20),
          const SizedBox(height: 8),
          Text(
            data.value,
            style: VibeMatchTextStyles.heading.copyWith(fontSize: 20),
          ),
          Text(
            data.label,
            style: VibeMatchTextStyles.body.copyWith(fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _RevenueBarChart extends StatelessWidget {
  const _RevenueBarChart({
    required this.breakdown,
    required this.currencySymbol,
  });

  final RevenueBreakdown breakdown;
  final String currencySymbol;

  @override
  Widget build(BuildContext context) {
    final bars = [
      _Bar('Escrow', breakdown.escrow, const Color(0xFF6366F1)),
      _Bar('Antecip.', breakdown.advance, const Color(0xFF06B6D4)),
      _Bar('BNPL', breakdown.bnpl, const Color(0xFFF59E0B)),
      _Bar('Manut.', breakdown.maintenance, const Color(0xFF10B981)),
      _Bar('Cursos', breakdown.course, const Color(0xFFEC4899)),
    ];
    final maxY =
        (bars.map((b) => b.value).fold<double>(0, (a, b) => a > b ? a : b)) *
            1.2;

    return VibeGlassCard(
      child: Column(
        children: [
          SizedBox(
            height: 180,
            child: BarChart(
              BarChartData(
                maxY: maxY == 0 ? 10 : maxY,
                gridData: const FlGridData(show: false),
                borderData: FlBorderData(show: false),
                titlesData: FlTitlesData(
                  leftTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      getTitlesWidget: (value, meta) {
                        final index = value.toInt();
                        if (index < 0 || index >= bars.length)
                          return const SizedBox.shrink();
                        return Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                            bars[index].label,
                            style: const TextStyle(
                              color: VibeMatchColors.textLow,
                              fontSize: 10,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
                barGroups: [
                  for (int i = 0; i < bars.length; i++)
                    BarChartGroupData(
                      x: i,
                      barRods: [
                        BarChartRodData(
                          toY: bars[i].value,
                          color: bars[i].color,
                          width: 22,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Total: $currencySymbol${NumberFormat('#,##0.00').format(breakdown.total)}',
                style: VibeMatchTextStyles.subheading,
              ),
              const Text(
                '*nominal — ver nota',
                style: TextStyle(color: VibeMatchColors.textLow, fontSize: 10),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Bar {
  const _Bar(this.label, this.value, this.color);
  final String label;
  final double value;
  final Color color;
}

class _MrrGmvChart extends StatelessWidget {
  const _MrrGmvChart({required this.metrics});
  final DashboardMetrics metrics;

  @override
  Widget build(BuildContext context) {
    return VibeGlassCard(
      child: SizedBox(
        height: 180,
        child: LineChart(
          LineChartData(
            gridData: const FlGridData(show: false),
            borderData: FlBorderData(show: false),
            titlesData: FlTitlesData(
              leftTitles: const AxisTitles(
                sideTitles: SideTitles(showTitles: false),
              ),
              rightTitles: const AxisTitles(
                sideTitles: SideTitles(showTitles: false),
              ),
              topTitles: const AxisTitles(
                sideTitles: SideTitles(showTitles: false),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  getTitlesWidget: (value, meta) {
                    const labels = ['MRR', 'GMV'];
                    final index = value.toInt();
                    if (index < 0 || index >= labels.length)
                      return const SizedBox.shrink();
                    return Text(
                      labels[index],
                      style: const TextStyle(
                        color: VibeMatchColors.textLow,
                        fontSize: 11,
                      ),
                    );
                  },
                ),
              ),
            ),
            lineBarsData: [
              LineChartBarData(
                spots: [FlSpot(0, metrics.mrr.usd), FlSpot(1, metrics.gmv.usd)],
                color: VibeMatchColors.neonPrimary,
                barWidth: 3,
                dotData: const FlDotData(show: true),
              ),
              LineChartBarData(
                spots: [FlSpot(0, metrics.mrr.brl), FlSpot(1, metrics.gmv.brl)],
                color: VibeMatchColors.scoreGold,
                barWidth: 3,
                dotData: const FlDotData(show: true),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
