import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/user_models.dart';
import '../../logic/subscription/subscription_cubit.dart';
import '../widgets/vibe_glass_card.dart';

class _Benefit {
  const _Benefit(this.icon, this.label);
  final IconData icon;
  final String label;
}

const _clientBenefits = [
  _Benefit(Icons.all_inclusive, 'Matches Ilimitados com Profissionais Premium'),
  _Benefit(Icons.translate, 'Tradução de Chat por IA'),
  _Benefit(Icons.shield, 'Seguro de Projetos'),
];

const _providerBenefits = [
  _Benefit(Icons.verified, 'Selo Verificado de Destaque'),
  _Benefit(Icons.visibility, 'Visualização de quem te deu Like'),
  _Benefit(Icons.bolt, 'Taxa de Antecipação de Recebíveis Reduzida'),
];

/// High-conversion paywall — dark violet-to-gold theme, locale-aware pricing
/// (BRL/Pix for Brazil, USD/Apple Pay elsewhere), role-specific benefit list.
class PaywallScreen extends StatefulWidget {
  const PaywallScreen({super.key, required this.user});

  final AppUser user;

  @override
  State<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends State<PaywallScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  bool get _isBrazil => widget.user.isBrazil;
  bool get _isClient => widget.user.role == UserRole.client;

  String get _priceLabel => _isBrazil ? 'R\$149/mês' : r'$49/mo';
  String get _paymentHint => _isBrazil ? 'Pix ou Cartão' : 'Apple Pay ou Cartão';
  List<_Benefit> get _benefits => _isClient ? _clientBenefits : _providerBenefits;
  String get _planTier => _isClient ? 'PREMIUM_CLIENT' : 'PRO_PROVIDER';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: BlocConsumer<SubscriptionCubit, SubscriptionState>(
        listener: (context, state) {
          if (state is SubscriptionError) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(state.message)));
          }
          if (state is SubscriptionCheckoutReady) {
            Navigator.of(context).pushNamed('/checkout-webview', arguments: state.checkoutUrl);
          }
        },
        builder: (context, state) {
          final processing = state is SubscriptionProcessing;
          return Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xFF1E112C), Color(0xFF0A0A0C)],
              ),
            ),
            child: SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 12),
                    ShaderMask(
                      shaderCallback: (bounds) => const LinearGradient(
                        colors: [Color(0xFF6366F1), VibeMatchColors.scoreGold],
                      ).createShader(bounds),
                      child: const Text(
                        'MatchService Premium',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '$_priceLabel · $_paymentHint',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: VibeMatchColors.textLow, fontSize: 16),
                    ),
                    const SizedBox(height: 28),
                    VibeGlassCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: _benefits
                            .map((b) => Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                  child: Row(
                                    children: [
                                      Icon(b.icon, color: VibeMatchColors.scoreGold, size: 22),
                                      const SizedBox(width: 14),
                                      Expanded(
                                        child: Text(b.label, style: VibeMatchTextStyles.subheading),
                                      ),
                                    ],
                                  ),
                                ))
                            .toList(),
                      ),
                    ),
                    const SizedBox(height: 32),
                    AnimatedBuilder(
                      animation: _pulseController,
                      builder: (context, child) {
                        final scale = 1.0 + (_pulseController.value * 0.03);
                        return Transform.scale(scale: scale, child: child);
                      },
                      child: _PremiumCta(
                        processing: processing,
                        onTap: processing
                            ? null
                            : () => context.read<SubscriptionCubit>().startCheckout(
                                  planTier: _planTier,
                                  currency: _isBrazil ? 'BRL' : 'USD',
                                ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      child: const Text('Agora não', style: TextStyle(color: VibeMatchColors.textLow)),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PremiumCta extends StatelessWidget {
  const _PremiumCta({required this.onTap, required this.processing});

  final VoidCallback? onTap;
  final bool processing;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: VibeMatchRadii.buttonRadius,
        gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF06B6D4)]),
        boxShadow: [
          BoxShadow(color: VibeMatchColors.neonPrimary.withOpacity(0.45), blurRadius: 20, spreadRadius: 1),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: VibeMatchRadii.buttonRadius,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 18),
            child: Center(
              child: processing
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text(
                      'Ativar Acesso Premium Instantâneo',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
