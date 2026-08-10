import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_card_swiper/flutter_card_swiper.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/feed_models.dart';
import '../../logic/swipe/swipe_cubit.dart';
import '../widgets/swipe_card.dart';
import 'match_success_screen.dart';
import 'paywall_screen.dart';

class SwipeDeckScreen extends StatefulWidget {
  const SwipeDeckScreen({super.key});

  @override
  State<SwipeDeckScreen> createState() => _SwipeDeckScreenState();
}

class _SwipeDeckScreenState extends State<SwipeDeckScreen> {
  final _controller = CardSwiperController();
  SwipeMode _mode = SwipeMode.cloud;

  bool _onSwipe(int previousIndex, int? currentIndex, CardSwiperDirection direction, List candidates) {
    final candidate = candidates[previousIndex];
    context.read<SwipeCubit>().swipe(
          swipedId: candidate.userId,
          like: direction == CardSwiperDirection.right,
          mode: _mode,
        );
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Pilha de Swipe'),
      ),
      body: BlocConsumer<SwipeCubit, SwipeState>(
        listener: (context, state) {
          if (state is SwipeStackLoaded) {
            setState(() => _mode = state.mode);
          }
          if (state is SwipeMatchFound) {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => MatchSuccessScreen(otherUserName: state.otherUserName, matchId: state.matchId),
              ),
            );
          }
          if (state is SwipePaywallRequired) {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const _PaywallGate()),
            );
          }
          if (state is SwipeError) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(state.message)));
          }
        },
        builder: (context, state) {
          if (state is SwipeLoading || state is SwipeIdle) {
            return const Center(child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary));
          }
          if (state is! SwipeStackLoaded || state.candidates.isEmpty) {
            return const Center(
              child: Text('Sem candidatos por aqui agora.', style: TextStyle(color: VibeMatchColors.textLow)),
            );
          }

          final candidates = state.candidates;
          return Padding(
            padding: const EdgeInsets.all(16),
            child: CardSwiper(
              controller: _controller,
              cardsCount: candidates.length,
              numberOfCardsDisplayed: candidates.length < 3 ? candidates.length : 3,
              onSwipe: (previousIndex, currentIndex, direction) =>
                  _onSwipe(previousIndex, currentIndex, direction, candidates),
              cardBuilder: (context, index, _, __) => SwipeCard(candidate: candidates[index]),
            ),
          );
        },
      ),
    );
  }
}

/// Placeholder gate — the real app resolves the current user then renders
/// PaywallScreen with it; wired here so SwipeDeckScreen's 402 handling has
/// somewhere concrete to navigate.
class _PaywallGate extends StatelessWidget {
  const _PaywallGate();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: Center(
        child: Text(
          'Limite diário de swipes atingido.\nAbra o Paywall para continuar.',
          textAlign: TextAlign.center,
          style: TextStyle(color: VibeMatchColors.textHigh),
        ),
      ),
    );
  }
}
