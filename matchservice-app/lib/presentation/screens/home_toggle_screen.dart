import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/feed_models.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/admin_repository.dart';
import '../../data/repositories/wallet_repository.dart';
import '../../logic/auth/auth_cubit.dart';
import '../../logic/swipe/swipe_cubit.dart';
import 'admin_dashboard.dart';
import 'admin_users_screen.dart';
import 'discovery_feed_screen.dart';
import 'swipe_deck_screen.dart';
import 'wallet_screen.dart';

/// Entry screen — the mode toggle the spec calls out explicitly:
/// "Nuvem ☁️ | Local 📍 | Networking B2B 🤝".
class HomeToggleScreen extends StatelessWidget {
  const HomeToggleScreen({super.key});

  void _enterSwipeMode(BuildContext context, SwipeMode mode) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BlocProvider(
          create: (context) => SwipeCubit(context.read())..loadStack(mode),
          child: const SwipeDeckScreen(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final authState = context.watch<AuthCubit>().state;
    final isAdmin =
        authState is AuthAuthenticated && authState.user.role == UserRole.admin;

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          if (isAdmin)
            IconButton(
              icon: const Icon(
                Icons.admin_panel_settings_outlined,
                color: VibeMatchColors.scoreGold,
              ),
              tooltip: 'Painel Admin',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => AdminDashboardScreen(
                    adminRepository: context.read<AdminRepository>(),
                  ),
                ),
              ),
            ),
          if (isAdmin)
            IconButton(
              icon: const Icon(
                Icons.people_outline,
                color: VibeMatchColors.scoreGold,
              ),
              tooltip: 'Gerenciar Usuários',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => AdminUsersScreen(
                    adminRepository: context.read<AdminRepository>(),
                  ),
                ),
              ),
            ),
          IconButton(
            icon: const Icon(
              Icons.account_balance_wallet_outlined,
              color: VibeMatchColors.neonPrimary,
            ),
            onPressed: () {
              final state = context.read<AuthCubit>().state;
              if (state is! AuthAuthenticated) return;
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => WalletScreen(
                    walletRepository: context.read<WalletRepository>(),
                    currentUser: state.user,
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'MatchService',
                style: VibeMatchTextStyles.heading.copyWith(fontSize: 30),
              ),
              const SizedBox(height: 8),
              const Text(
                'Como você quer explorar hoje?',
                style: TextStyle(color: VibeMatchColors.textLow),
              ),
              const SizedBox(height: 40),
              _ModeButton(
                emoji: '☁️',
                label: 'Nuvem',
                subtitle: 'Profissionais do mundo todo',
                onTap: () => _enterSwipeMode(context, SwipeMode.cloud),
              ),
              const SizedBox(height: 16),
              _ModeButton(
                emoji: '📍',
                label: 'Local',
                subtitle: 'Prestadores perto de você',
                onTap: () => _enterSwipeMode(context, SwipeMode.local),
              ),
              const SizedBox(height: 16),
              _ModeButton(
                emoji: '🤝',
                label: 'Networking B2B',
                subtitle: 'Parcerias e joint ventures',
                onTap: () => _enterSwipeMode(context, SwipeMode.b2b),
              ),
              const SizedBox(height: 32),
              TextButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const DiscoveryFeedScreen(),
                  ),
                ),
                icon: const Icon(
                  Icons.explore,
                  color: VibeMatchColors.neonPrimary,
                ),
                label: const Text(
                  'Explorar Feed de Descoberta',
                  style: TextStyle(color: VibeMatchColors.neonPrimary),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({
    required this.emoji,
    required this.label,
    required this.subtitle,
    required this.onTap,
  });

  final String emoji;
  final String label;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: VibeMatchColors.surface,
      borderRadius: VibeMatchRadii.cardRadius,
      child: InkWell(
        borderRadius: VibeMatchRadii.cardRadius,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 20),
          child: Row(
            children: [
              Text(emoji, style: const TextStyle(fontSize: 32)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: VibeMatchTextStyles.subheading.copyWith(
                        fontSize: 18,
                      ),
                    ),
                    Text(subtitle, style: VibeMatchTextStyles.body),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: VibeMatchColors.textLow),
            ],
          ),
        ),
      ),
    );
  }
}
