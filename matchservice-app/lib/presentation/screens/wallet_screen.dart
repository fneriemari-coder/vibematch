import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/user_models.dart';
import '../../data/models/wallet_models.dart';
import '../../data/repositories/wallet_repository.dart';
import '../../logic/wallet/wallet_cubit.dart';
import '../widgets/pulsing_status_dot.dart';
import '../widgets/vibe_glass_card.dart';

/// Fintech-grade wallet dashboard: glowing K-Score header, glassmorphism
/// balance + BNPL credit cards, and an animated installments/milestones
/// timeline — built to read as a luxury fintech product, not a utility screen.
class WalletScreen extends StatelessWidget {
  const WalletScreen({
    super.key,
    required this.walletRepository,
    required this.currentUser,
  });

  final WalletRepository walletRepository;
  final AppUser currentUser;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => WalletCubit(walletRepository)
        ..load(
          initialBalance: currentUser.walletBalance,
          currency: currentUser.isBrazil ? 'BRL' : 'USD',
          userId: currentUser.id,
        ),
      child: _WalletView(currentUser: currentUser),
    );
  }
}

class _WalletView extends StatelessWidget {
  const _WalletView({required this.currentUser});

  final AppUser currentUser;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Carteira'),
      ),
      body: BlocConsumer<WalletCubit, WalletState>(
        listener: (context, state) {
          if (state is WalletError) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(SnackBar(content: Text(state.message)));
          }
        },
        builder: (context, state) {
          if (state is WalletLoading || state is WalletInitial) {
            return const Center(
              child: CircularProgressIndicator(
                color: VibeMatchColors.neonPrimary,
              ),
            );
          }
          if (state is! WalletLoaded) {
            return const Center(
              child: Text(
                'Não foi possível carregar a carteira.',
                style: TextStyle(color: VibeMatchColors.textLow),
              ),
            );
          }

          return RefreshIndicator(
            color: VibeMatchColors.neonPrimary,
            onRefresh: () => context.read<WalletCubit>().load(
              initialBalance: state.balance,
              currency: state.currency,
              userId: currentUser.id,
            ),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _KScoreHeader(kScore: state.kScore),
                const SizedBox(height: 24),
                _BalanceCard(state: state),
                const SizedBox(height: 16),
                if (currentUser.role == UserRole.client ||
                    currentUser.role == UserRole.both)
                  _BnplCreditCard(
                    limit: state.bnplCreditLimit,
                    currency: state.currency,
                  ),
                const SizedBox(height: 28),
                Text(
                  'Linha do tempo',
                  style: VibeMatchTextStyles.heading.copyWith(fontSize: 18),
                ),
                const SizedBox(height: 12),
                if (state.timeline.items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(
                      child: Text(
                        'Nenhuma parcela ou meta por aqui ainda.',
                        style: TextStyle(color: VibeMatchColors.textLow),
                      ),
                    ),
                  )
                else
                  ...state.timeline.items.map(
                    (item) => _TimelineTile(item: item),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _KScoreHeader extends StatelessWidget {
  const _KScoreHeader({required this.kScore});

  final int kScore;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          'K-SCORE DIGITAL',
          style: VibeMatchTextStyles.body.copyWith(letterSpacing: 2),
        ),
        const SizedBox(height: 10),
        ShaderMask(
          shaderCallback: (bounds) => const LinearGradient(
            colors: [
              VibeMatchColors.scoreGold,
              Color(0xFFFFE9A8),
              VibeMatchColors.scoreGold,
            ],
          ).createShader(bounds),
          child: Text(
            kScore.toString().padLeft(4, '0'),
            style: const TextStyle(
              fontSize: 56,
              fontWeight: FontWeight.w900,
              color: Colors.white,
              letterSpacing: 2,
              shadows: [
                Shadow(color: VibeMatchColors.scoreGold, blurRadius: 24),
              ],
            ),
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Termômetro de confiança do prestador',
          style: TextStyle(color: VibeMatchColors.textLow, fontSize: 12),
        ),
      ],
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.state});

  final WalletLoaded state;

  String _formatMoney(double amount, String currency) {
    final symbol = currency == 'BRL' ? 'R\$' : r'$';
    return '$symbol${NumberFormat('#,##0.00').format(amount)}';
  }

  @override
  Widget build(BuildContext context) {
    return VibeGlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Saldo Disponível',
            style: TextStyle(color: VibeMatchColors.textLow, fontSize: 13),
          ),
          const SizedBox(height: 8),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 400),
            transitionBuilder: (child, animation) => FadeTransition(
              opacity: animation,
              child: ScaleTransition(scale: animation, child: child),
            ),
            child: Text(
              _formatMoney(state.balance, state.currency),
              key: ValueKey(state.balance),
              style: VibeMatchTextStyles.heading.copyWith(fontSize: 30),
            ),
          ),
          if (state.actionPending) ...[
            const SizedBox(height: 8),
            const LinearProgressIndicator(
              color: VibeMatchColors.neonPrimary,
              backgroundColor: VibeMatchColors.background,
            ),
          ],
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: VibeMatchColors.textHigh,
                    side: const BorderSide(color: VibeMatchColors.textLow),
                  ),
                  onPressed: state.actionPending
                      ? null
                      : () => _showWithdrawSheet(context, state),
                  icon: const Icon(
                    Icons.account_balance_wallet_outlined,
                    size: 18,
                  ),
                  label: const Text('Sacar'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: VibeMatchColors.neonPrimary,
                    foregroundColor: Colors.black,
                  ),
                  onPressed: state.actionPending
                      ? null
                      : () => _showAdvanceSheet(context),
                  icon: const Icon(Icons.bolt, size: 18),
                  label: const Text('Antecipar'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showWithdrawSheet(BuildContext context, WalletLoaded state) {
    final controller = TextEditingController();
    final cubit = context.read<WalletCubit>();
    showModalBottomSheet(
      context: context,
      backgroundColor: VibeMatchColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Sacar saldo',
              style: VibeMatchTextStyles.heading.copyWith(fontSize: 18),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Valor'),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                final amount = double.tryParse(
                  controller.text.replaceAll(',', '.'),
                );
                if (amount == null || amount <= 0) return;
                Navigator.of(sheetContext).pop();
                cubit.withdraw(amount);
              },
              child: const Text('Confirmar saque'),
            ),
          ],
        ),
      ),
    );
  }

  void _showAdvanceSheet(BuildContext context) {
    final controller = TextEditingController();
    final cubit = context.read<WalletCubit>();
    showModalBottomSheet(
      context: context,
      backgroundColor: VibeMatchColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Antecipar Recebíveis',
              style: VibeMatchTextStyles.heading.copyWith(fontSize: 18),
            ),
            const SizedBox(height: 8),
            const Text(
              'Informe o ID do projeto em Escrow (status FUNDED) para receber agora, com desconto de taxa de risco.',
              style: TextStyle(color: VibeMatchColors.textLow, fontSize: 13),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'ID do projeto (Escrow)',
              ),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: VibeMatchColors.neonPrimary,
                foregroundColor: Colors.black,
              ),
              onPressed: () {
                if (controller.text.trim().isEmpty) return;
                Navigator.of(sheetContext).pop();
                cubit.instantAdvance(controller.text.trim());
              },
              child: const Text('Antecipar agora'),
            ),
          ],
        ),
      ),
    );
  }
}

class _BnplCreditCard extends StatelessWidget {
  const _BnplCreditCard({required this.limit, required this.currency});

  final double limit;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final symbol = currency == 'BRL' ? 'R\$' : r'$';
    return VibeGlassCard(
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                colors: [Color(0xFF6366F1), Color(0xFF06B6D4)],
              ),
            ),
            child: const Icon(
              Icons.credit_score,
              color: Colors.white,
              size: 22,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Crédito Financiado (BNPL)',
                  style: TextStyle(
                    color: VibeMatchColors.textLow,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$symbol${NumberFormat('#,##0').format(limit)} aprovados',
                  style: VibeMatchTextStyles.subheading.copyWith(
                    fontSize: 17,
                    color: VibeMatchColors.scoreGold,
                  ),
                ),
                const Text(
                  'Financie projetos em parcelas — exclusivo para contratantes',
                  style: TextStyle(
                    color: VibeMatchColors.textLow,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TimelineTile extends StatelessWidget {
  const _TimelineTile({required this.item});

  final TimelineItem item;

  @override
  Widget build(BuildContext context) {
    final symbol = item.currency == 'BRL' ? 'R\$' : r'$';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: VibeGlassCard(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            PulsingStatusDot(status: item.status),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.label,
                    style: VibeMatchTextStyles.subheading.copyWith(
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    labelFor(item.status),
                    style: VibeMatchTextStyles.body.copyWith(fontSize: 12),
                  ),
                ],
              ),
            ),
            Text(
              '$symbol${NumberFormat('#,##0.00').format(item.amount)}',
              style: VibeMatchTextStyles.subheading.copyWith(fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }
}
