import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_card_swiper/flutter_card_swiper.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api/dio_client.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/feed_models.dart';
import '../../data/models/user_models.dart';
import '../../logic/auth/auth_cubit.dart';
import '../../logic/subscription/subscription_cubit.dart';
import '../../logic/swipe/swipe_cubit.dart';
import '../widgets/swipe_card.dart';
import '../widgets/vibe_ui.dart';
import 'match_success_screen.dart';
import 'paywall_screen.dart';

/// The deck — the core mechanic of the marketplace.
///
/// A match needs both sides to say yes, so this is deliberately the familiar
/// card-stack gesture: drag right to connect, left to pass, with the same
/// action available as large buttons for anyone who would rather tap. The
/// three modes are switched in place rather than behind a menu, because which
/// pool you are looking at is the single most important piece of context and
/// the previous version hid it entirely.
class SwipeDeckScreen extends StatefulWidget {
  const SwipeDeckScreen({super.key, this.initialMode = SwipeMode.cloud});

  final SwipeMode initialMode;

  @override
  State<SwipeDeckScreen> createState() => _SwipeDeckScreenState();
}

class _SwipeDeckScreenState extends State<SwipeDeckScreen> {
  final _controller = CardSwiperController();
  late SwipeMode _mode = widget.initialMode;

  /// Cards consumed so far, so "restam N" counts down without refetching.
  int _consumed = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// LOCAL mode is meaningless without coordinates — the server sorts by real
  /// distance. Permission may be denied (or unavailable on the web build), in
  /// which case we still load the deck and simply lose the distance ordering,
  /// rather than blocking the user behind a permission wall.
  Future<({double? lat, double? lng})> _resolvePosition() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled())
        return (lat: null, lng: null);
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return (lat: null, lng: null);
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 8),
        ),
      );
      return (lat: position.latitude, lng: position.longitude);
    } catch (_) {
      return (lat: null, lng: null);
    }
  }

  Future<void> _loadMode(SwipeMode mode) async {
    setState(() {
      _mode = mode;
      _consumed = 0;
    });
    final cubit = context.read<SwipeCubit>();
    if (mode == SwipeMode.local) {
      final position = await _resolvePosition();
      if (!mounted) return;
      await cubit.loadStack(mode, lat: position.lat, lng: position.lng);
      return;
    }
    await cubit.loadStack(mode);
  }

  bool _onSwipe(
    int previousIndex,
    int? currentIndex,
    CardSwiperDirection direction,
    List<SwipeCandidate> candidates,
  ) {
    final candidate = candidates[previousIndex];
    context.read<SwipeCubit>().swipe(
          swipedId: candidate.userId,
          like: direction == CardSwiperDirection.right,
          mode: _mode,
        );
    setState(() => _consumed = previousIndex + 1);
    return true;
  }

  void _openPaywall() {
    final authState = context.read<AuthCubit>().state;
    if (authState is! AuthAuthenticated) return;
    final dioClient = context.read<DioClient>();
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BlocProvider(
          create: (_) => SubscriptionCubit(dioClient),
          child: PaywallScreen(user: authState.user),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _modeBar(),
            Expanded(
              child: BlocConsumer<SwipeCubit, SwipeState>(
                listener: (context, state) {
                  if (state is SwipeStackLoaded) {
                    setState(() => _mode = state.mode);
                  }
                  if (state is SwipeMatchFound) {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => MatchSuccessScreen(
                          otherUserName: state.otherUserName,
                          matchId: state.matchId,
                        ),
                      ),
                    );
                  }
                  if (state is SwipePaywallRequired) {
                    _openPaywall();
                  }
                  if (state is SwipeError) {
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(SnackBar(content: Text(state.message)));
                  }
                },
                builder: (context, state) {
                  if (state is SwipeLoading || state is SwipeIdle) {
                    return const Center(
                      child: CircularProgressIndicator(
                        color: VibeMatchColors.neonPrimary,
                      ),
                    );
                  }
                  if (state is SwipeError) {
                    return VibeErrorState(
                      message: state.message,
                      onRetry: () => _loadMode(_mode),
                    );
                  }
                  final candidates = state is SwipeStackLoaded
                      ? state.candidates
                      : const <SwipeCandidate>[];
                  if (candidates.isEmpty) {
                    return _emptyDeck();
                  }
                  if (_consumed >= candidates.length) {
                    return _exhaustedDeck();
                  }
                  return _deck(candidates);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  // --- Mode switcher ------------------------------------------------------

  Widget _modeBar() {
    const modes = [
      (SwipeMode.cloud, Icons.public_rounded, 'Nuvem'),
      (SwipeMode.local, Icons.place_rounded, 'Local'),
      (SwipeMode.b2b, Icons.handshake_rounded, 'B2B'),
    ];

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        VibeMatchSpacing.gutter,
        12,
        VibeMatchSpacing.gutter,
        14,
      ),
      child: Row(
        children: modes.map((m) {
          final selected = m.$1 == _mode;
          return Expanded(
            child: Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Material(
                color: selected
                    ? VibeMatchColors.neonPrimary
                    : VibeMatchColors.surface,
                borderRadius: VibeMatchRadii.pillRadius,
                child: InkWell(
                  borderRadius: VibeMatchRadii.pillRadius,
                  onTap: selected ? null : () => _loadMode(m.$1),
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    decoration: BoxDecoration(
                      borderRadius: VibeMatchRadii.pillRadius,
                      border: Border.all(
                        color: selected
                            ? VibeMatchColors.neonPrimary
                            : VibeMatchColors.border,
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          m.$2,
                          size: 15,
                          color: selected
                              ? VibeMatchColors.ink
                              : VibeMatchColors.textLow,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          m.$3,
                          style: VibeMatchTextStyles.caption.copyWith(
                            fontWeight: FontWeight.w700,
                            color: selected
                                ? VibeMatchColors.ink
                                : VibeMatchColors.textHigh,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  // --- The stack ----------------------------------------------------------

  Widget _deck(List<SwipeCandidate> candidates) {
    final remaining = candidates.length - _consumed;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text(
            remaining == 1 ? 'Resta 1 perfil' : 'Restam $remaining perfis',
            style: VibeMatchTextStyles.caption,
          ),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: VibeMatchSpacing.gutter,
            ),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: CardSwiper(
                  controller: _controller,
                  cardsCount: candidates.length,
                  numberOfCardsDisplayed:
                      candidates.length < 3 ? candidates.length : 3,
                  backCardOffset: const Offset(0, 34),
                  padding: EdgeInsets.zero,
                  // Up/down carry no meaning here — only like and pass exist,
                  // and allowing a vertical fling would consume a card with no
                  // decision attached to it.
                  allowedSwipeDirection: const AllowedSwipeDirection.symmetric(
                    horizontal: true,
                  ),
                  onSwipe: (previous, current, direction) =>
                      _onSwipe(previous, current, direction, candidates),
                  cardBuilder: (context, index, percentX, percentY) => Stack(
                    fit: StackFit.expand,
                    children: [
                      SwipeCard(
                        candidate: candidates[index],
                        dragging: percentX.abs() > 5,
                      ),
                      // The stamp is the feedback that makes the gesture feel
                      // decided rather than accidental — it tracks the drag
                      // and fades in with it.
                      _DecisionStamp(percentX: percentX),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        _actionBar(),
      ],
    );
  }

  Widget _actionBar() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 22),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _ActionButton(
            icon: Icons.close_rounded,
            color: VibeMatchColors.negative,
            size: 62,
            tooltip: 'Passar',
            onTap: () => _controller.swipe(CardSwiperDirection.left),
          ),
          const SizedBox(width: 28),
          _ActionButton(
            icon: Icons.bolt_rounded,
            color: VibeMatchColors.neonPrimary,
            size: 74,
            filled: true,
            tooltip: 'Conectar',
            onTap: () => _controller.swipe(CardSwiperDirection.right),
          ),
        ],
      ),
    );
  }

  // --- Empty states -------------------------------------------------------

  Widget _emptyDeck() {
    final message = switch (_mode) {
      SwipeMode.local =>
        'Ninguém por perto ainda. Tente o modo Nuvem, que não tem limite de distância.',
      SwipeMode.b2b =>
        'Nenhum perfil aberto a parceria no momento. Ative o networking B2B no seu perfil para aparecer aqui também.',
      SwipeMode.cloud =>
        'Nenhum profissional disponível agora. Puxe para atualizar em instantes.',
    };
    return VibeEmptyState(
      icon: Icons.style_outlined,
      title: 'Pilha vazia',
      message: message,
      action: OutlinedButton(
        onPressed: () => _loadMode(_mode),
        child: const Text('Atualizar'),
      ),
    );
  }

  Widget _exhaustedDeck() {
    return VibeEmptyState(
      icon: Icons.check_circle_outline_rounded,
      title: 'Você viu todo mundo por aqui',
      message:
          'Passou por todos os perfis desta pilha. Troque de modo ou atualize '
          'para ver quem entrou depois.',
      action: ElevatedButton(
        onPressed: () => _loadMode(_mode),
        child: const Text('Buscar novos perfis'),
      ),
    );
  }
}

/// "CONECTAR" / "PASSAR" stamp that tracks the drag.
class _DecisionStamp extends StatelessWidget {
  const _DecisionStamp({required this.percentX});

  /// Horizontal drag as a percentage, negative to the left.
  final int percentX;

  @override
  Widget build(BuildContext context) {
    if (percentX.abs() < 8) return const SizedBox.shrink();
    final liking = percentX > 0;
    final opacity = (percentX.abs() / 60).clamp(0.0, 1.0);
    final colour =
        liking ? VibeMatchColors.neonPrimary : VibeMatchColors.negative;

    return IgnorePointer(
      child: Opacity(
        opacity: opacity,
        child: Align(
          alignment: liking ? Alignment.topLeft : Alignment.topRight,
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Transform.rotate(
              angle: liking ? -0.22 : 0.22,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  border: Border.all(color: colour, width: 3),
                  borderRadius: VibeMatchRadii.buttonRadius,
                  color: VibeMatchColors.ink.withOpacity(0.35),
                ),
                child: Text(
                  liking ? 'CONECTAR' : 'PASSAR',
                  style: VibeMatchTextStyles.eyebrow.copyWith(
                    color: colour,
                    fontSize: 17,
                    letterSpacing: 2,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.color,
    required this.size,
    required this.tooltip,
    required this.onTap,
    this.filled = false,
  });

  final IconData icon;
  final Color color;
  final double size;
  final String tooltip;
  final VoidCallback onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: filled ? color : VibeMatchColors.surface,
        shape: const CircleBorder(),
        elevation: filled ? 8 : 0,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Container(
            height: size,
            width: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border:
                  Border.all(color: filled ? color : color.withOpacity(0.6)),
            ),
            child: Icon(
              icon,
              size: size * 0.42,
              color: filled ? VibeMatchColors.ink : color,
            ),
          ),
        ),
      ),
    );
  }
}
