import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/feed_models.dart';
import '../../data/models/mastermind_models.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/admin_repository.dart';
import '../../data/repositories/content_repository.dart';
import '../../data/repositories/diagnostic_repository.dart';
import '../../data/repositories/mastermind_repository.dart';
import '../../data/repositories/wallet_repository.dart';
import '../../logic/auth/auth_cubit.dart';
import '../../logic/swipe/swipe_cubit.dart';
import '../widgets/vibe_logo.dart';
import '../widgets/vibe_ui.dart';
import 'admin_dashboard.dart';
import 'admin_users_screen.dart';
import 'content_screen.dart';
import 'diagnostic_screen.dart';
import 'swipe_deck_screen.dart';
import 'wallet_screen.dart';

/// Home.
///
/// Replaces the original three-button menu. That screen said "MatchService" and
/// offered nothing but the swipe modes, so the platform's whole education and
/// content side was invisible from the first screen. This one opens with the
/// positioning, then puts the three discovery modes, the next live sessions,
/// and the routes into the academy, mentoring and editorial sections all on one
/// scroll.
class HomeToggleScreen extends StatefulWidget {
  const HomeToggleScreen({super.key, this.onNavigateToTab});

  /// Switches the shell's bottom-navigation tab. Null when this screen is
  /// pushed outside the shell, in which case the section links fall back to
  /// pushing routes.
  final ValueChanged<int>? onNavigateToTab;

  @override
  State<HomeToggleScreen> createState() => _HomeToggleScreenState();
}

class _HomeToggleScreenState extends State<HomeToggleScreen> {
  late Future<List<MastermindSession>> _sessions;

  @override
  void initState() {
    super.initState();
    _sessions = _loadSessions();
  }

  Future<List<MastermindSession>> _loadSessions() =>
      context.read<MastermindRepository>().listUpcoming(limit: 6);

  void _enterSwipeMode(BuildContext context, SwipeMode mode) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BlocProvider(
          create: (context) => SwipeCubit(context.read())..loadStack(mode),
          child: SwipeDeckScreen(initialMode: mode),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final authState = context.watch<AuthCubit>().state;
    final user = authState is AuthAuthenticated ? authState.user : null;
    final isAdmin = user?.role == UserRole.admin;

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: RefreshIndicator(
        color: VibeMatchColors.neonPrimary,
        backgroundColor: VibeMatchColors.surface,
        onRefresh: () async {
          final refreshed = _loadSessions();
          setState(() => _sessions = refreshed);
          await refreshed.catchError((_) => <MastermindSession>[]);
        },
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _hero(isAdmin: isAdmin)),
            const SliverToBoxAdapter(
              child: SizedBox(height: VibeMatchSpacing.sectionGap),
            ),
            SliverToBoxAdapter(child: _diagnosticBand()),
            const SliverToBoxAdapter(
              child: SizedBox(height: VibeMatchSpacing.sectionGap),
            ),
            SliverToBoxAdapter(child: _modes()),
            const SliverToBoxAdapter(
              child: SizedBox(height: VibeMatchSpacing.sectionGap),
            ),
            SliverToBoxAdapter(child: _liveSessions()),
            const SliverToBoxAdapter(
              child: SizedBox(height: VibeMatchSpacing.sectionGap),
            ),
            SliverToBoxAdapter(child: _grow()),
            if (user != null) ...[
              const SliverToBoxAdapter(
                child: SizedBox(height: VibeMatchSpacing.sectionGap),
              ),
              SliverToBoxAdapter(child: _wallet(user)),
            ],
            const SliverToBoxAdapter(child: SizedBox(height: 40)),
          ],
        ),
      ),
    );
  }

  // --- Hero ---------------------------------------------------------------

  Widget _hero({required bool isAdmin}) {
    return Stack(
      children: [
        VibeCinematicHero(
          height: 430,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              VibeMatchSpacing.gutter,
              0,
              VibeMatchSpacing.gutter,
              32,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'PLATAFORMA DE NEGÓCIOS',
                  style: VibeMatchTextStyles.eyebrow,
                ),
                const SizedBox(height: 14),
                const VibeHeroHeadline(
                  text: 'Construa sua empresa com quem já',
                  accent: 'executou antes.',
                ),
                const SizedBox(height: 18),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Text(
                    'Encontre profissionais, contrate com garantia, e aprenda '
                    'com quem faz — tudo no mesmo lugar.',
                    style: VibeMatchTextStyles.body.copyWith(fontSize: 15),
                  ),
                ),
                const SizedBox(height: 26),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    ElevatedButton.icon(
                      onPressed: () => _goToTab(1),
                      icon: const Icon(Icons.bolt_rounded, size: 18),
                      label: const Text('Encontrar profissionais'),
                    ),
                    OutlinedButton(
                      onPressed: () => _goToTab(3),
                      child: const Text('Ver programas'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: VibeMatchSpacing.gutter,
                vertical: 8,
              ),
              child: Row(
                children: [
                  const VibeLogo(markSize: 28, fontSize: 15),
                  const Spacer(),
                  if (isAdmin) ...[
                    IconButton(
                      icon: const Icon(
                        Icons.insights_rounded,
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
                    IconButton(
                      icon: const Icon(
                        Icons.manage_accounts_outlined,
                        color: VibeMatchColors.scoreGold,
                      ),
                      tooltip: 'Gerenciar usuários',
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => AdminUsersScreen(
                            adminRepository: context.read<AdminRepository>(),
                          ),
                        ),
                      ),
                    ),
                  ],
                  IconButton(
                    icon: const Icon(Icons.privacy_tip_outlined),
                    tooltip: 'Meus dados',
                    onPressed: () =>
                        Navigator.of(context).pushNamed('/privacy'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  // --- Diagnostic ---------------------------------------------------------

  /// Sits directly under the hero, above the discovery modes, because it is
  /// the entry point that makes the rest of the product make sense: it turns
  /// "eu tenho um problema" into a scored brief, and the brief is what the
  /// matching engine, the courses and the mentors all key off.
  Widget _diagnosticBand() {
    return VibeContent(
      child: VibeCard(
        highlighted: true,
        padding: const EdgeInsets.all(22),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => DiagnosticScreen(
              diagnosticRepository: context.read<DiagnosticRepository>(),
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('DIAGNÓSTICO', style: VibeMatchTextStyles.eyebrow),
                const SizedBox(width: 8),
                const VibeTag(label: 'Gratuito'),
              ],
            ),
            const SizedBox(height: 12),
            RichText(
              text: TextSpan(
                style: VibeMatchTextStyles.sectionTitle,
                children: [
                  const TextSpan(text: 'Descubra onde sua empresa'),
                  TextSpan(
                    text: ' está travando.',
                    style: VibeMatchTextStyles.sectionTitleAccent,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Conte o que está acontecendo, em suas palavras. Devolvemos uma '
              'nota de 0 a 100 em Vendas, Gestão, Tecnologia e Finanças — e '
              'quem contratar para resolver o pilar mais fraco.',
              style: VibeMatchTextStyles.body,
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                ElevatedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => DiagnosticScreen(
                        diagnosticRepository:
                            context.read<DiagnosticRepository>(),
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.radar_rounded, size: 18),
                  label: const Text('Fazer diagnóstico'),
                ),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(
                    'Leva de 10 a 30 segundos.',
                    style: VibeMatchTextStyles.caption,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // --- Discovery modes ----------------------------------------------------

  Widget _modes() {
    const modes = [
      (
        SwipeMode.cloud,
        Icons.public_rounded,
        'Nuvem',
        'Profissionais do mundo todo, sem limite de distância.',
      ),
      (
        SwipeMode.local,
        Icons.place_rounded,
        'Local',
        'Quem atende perto de você, ordenado por distância real.',
      ),
      (
        SwipeMode.b2b,
        Icons.handshake_rounded,
        'Networking B2B',
        'Parcerias, joint ventures e troca de carteira.',
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const VibeContent(
          child: VibeSectionHeader(
            eyebrow: 'Descobrir',
            title: 'Como você quer',
            titleAccent: 'explorar hoje?',
            subtitle:
                'Um match só abre conversa quando os dois lados dizem sim.',
          ),
        ),
        const SizedBox(height: 20),
        VibeContent(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 860 ? 3 : 1;
              return Wrap(
                spacing: 14,
                runSpacing: 14,
                children: modes.map((m) {
                  final width = columns == 1
                      ? constraints.maxWidth
                      : (constraints.maxWidth - 14 * (columns - 1)) / columns;
                  return SizedBox(
                    width: width,
                    child: _ModeCard(
                      icon: m.$2,
                      label: m.$3,
                      subtitle: m.$4,
                      onTap: () => _enterSwipeMode(context, m.$1),
                    ),
                  );
                }).toList(),
              );
            },
          ),
        ),
      ],
    );
  }

  // --- Upcoming live sessions --------------------------------------------

  Widget _liveSessions() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        VibeContent(
          child: VibeSectionHeader(
            eyebrow: 'Ao vivo',
            title: 'Próximas',
            titleAccent: 'mentorias',
            subtitle: 'Sessões ao vivo com quem já resolveu o seu problema.',
            action: TextButton(
              onPressed: () => _goToTab(4),
              child: const Text('Ver todas'),
            ),
          ),
        ),
        const SizedBox(height: 18),
        FutureBuilder<List<MastermindSession>>(
          future: _sessions,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const SizedBox(
                height: 130,
                child: Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                ),
              );
            }
            if (snapshot.hasError) {
              return VibeErrorState(
                message: 'Não conseguimos buscar as sessões agora.',
                onRetry: () => setState(() => _sessions = _loadSessions()),
              );
            }
            final sessions = snapshot.data ?? const <MastermindSession>[];
            if (sessions.isEmpty) {
              return const VibeEmptyState(
                icon: Icons.event_available_outlined,
                title: 'Nenhuma sessão agendada',
                message:
                    'Assim que um mentor abrir uma sessão ao vivo, ela aparece aqui.',
              );
            }
            return VibeCardRail(
              height: 176,
              cardWidth: 290,
              itemCount: sessions.length,
              itemBuilder: (context, i) =>
                  _SessionCard(session: sessions[i], onTap: () => _goToTab(4)),
            );
          },
        ),
      ],
    );
  }

  // --- Routes into the education side ------------------------------------

  Widget _grow() {
    return VibeContent(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const VibeSectionHeader(
            eyebrow: 'Evoluir',
            title: 'Aprenda enquanto',
            titleAccent: 'fecha negócio.',
          ),
          const SizedBox(height: 20),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 860 ? 3 : 1;
              final entries = <(IconData, String, String, VoidCallback)>[
                (
                  Icons.school_rounded,
                  'Cursos',
                  'Programas curtos e aplicáveis, com certificado e material.',
                  () => _goToTab(3),
                ),
                (
                  Icons.groups_rounded,
                  'Mentorias e comunidades',
                  'Mentores, sessões ao vivo e círculos por convite.',
                  () => _goToTab(4),
                ),
                (
                  Icons.article_rounded,
                  'Conteúdo',
                  'Artigos de gestão, vendas e liderança — e publique o seu.',
                  () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ContentScreen(
                            contentRepository:
                                context.read<ContentRepository>(),
                          ),
                        ),
                      ),
                ),
              ];
              return Wrap(
                spacing: 14,
                runSpacing: 14,
                children: entries.map((e) {
                  final width = columns == 1
                      ? constraints.maxWidth
                      : (constraints.maxWidth - 14 * (columns - 1)) / columns;
                  return SizedBox(
                    width: width,
                    child: _ModeCard(
                      icon: e.$1,
                      label: e.$2,
                      subtitle: e.$3,
                      onTap: e.$4,
                    ),
                  );
                }).toList(),
              );
            },
          ),
        ],
      ),
    );
  }

  // --- Wallet strip -------------------------------------------------------

  Widget _wallet(AppUser user) {
    final symbol = user.isBrazil ? 'R\$' : 'US\$';
    return VibeContent(
      child: VibeCard(
        padding: const EdgeInsets.all(20),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => WalletScreen(
              walletRepository: context.read<WalletRepository>(),
              currentUser: user,
            ),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: VibeStat(
                value: '$symbol ${user.walletBalance.toStringAsFixed(2)}',
                caption: 'Saldo disponível na carteira',
                size: 30,
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              color: VibeMatchColors.neonPrimary,
            ),
          ],
        ),
      ),
    );
  }

  void _goToTab(int index) {
    final navigate = widget.onNavigateToTab;
    if (navigate != null) {
      navigate(index);
      return;
    }
    // Outside the shell there is no tab bar to switch; the feed is the one
    // section that already has a named route.
    if (index == 1) Navigator.of(context).pushNamed('/discovery-feed');
  }
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return VibeCard(
      onTap: onTap,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 26, color: VibeMatchColors.neonPrimary),
          const SizedBox(height: 16),
          Text(label, style: VibeMatchTextStyles.cardTitle),
          const SizedBox(height: 6),
          Text(subtitle, style: VibeMatchTextStyles.body),
          const SizedBox(height: 14),
          Row(
            children: [
              Text(
                'Abrir',
                style: VibeMatchTextStyles.caption.copyWith(
                  color: VibeMatchColors.neonPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.arrow_forward_rounded,
                size: 13,
                color: VibeMatchColors.neonPrimary,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SessionCard extends StatelessWidget {
  const _SessionCard({required this.session, required this.onTap});

  final MastermindSession session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final until = session.scheduledFor.difference(DateTime.now());
    final isImminent = until.inHours < 1 && !until.isNegative;

    return VibeCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (isImminent)
                const VibeTag(
                  label: 'Ao vivo',
                  color: VibeMatchColors.live,
                  filled: true,
                )
              else
                VibeTag(label: _formatDate(session.scheduledFor)),
              const Spacer(),
              Text(
                '${session.bookingsCount} inscritos',
                style: VibeMatchTextStyles.caption,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Expanded(
            child: Text(
              session.title,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: VibeMatchTextStyles.cardTitle,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'com ${session.hostName}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: VibeMatchTextStyles.caption,
          ),
        ],
      ),
    );
  }

  static String _formatDate(DateTime when) {
    const months = [
      'jan',
      'fev',
      'mar',
      'abr',
      'mai',
      'jun',
      'jul',
      'ago',
      'set',
      'out',
      'nov',
      'dez',
    ];
    final hour = when.hour.toString().padLeft(2, '0');
    final minute = when.minute.toString().padLeft(2, '0');
    return '${when.day} ${months[when.month - 1]} · ${hour}h$minute';
  }
}
