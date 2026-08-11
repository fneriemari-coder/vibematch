import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_card_swiper/flutter_card_swiper.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../core/api/dio_client.dart';
import '../../data/models/feed_models.dart';
import '../../logic/auth/auth_cubit.dart';
import '../../logic/subscription/subscription_cubit.dart';
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

  bool _onSwipe(
    int previousIndex,
    int? currentIndex,
    CardSwiperDirection direction,
    List candidates,
  ) {
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
                builder: (_) => MatchSuccessScreen(
                  otherUserName: state.otherUserName,
                  matchId: state.matchId,
                ),
              ),
            );
          }
          if (state is SwipePaywallRequired) {
            // PaywallScreen needs both the signed-in user (its pricing and
            // benefit list are role- and country-specific) and its own
            // SubscriptionCubit, which is not provided app-wide.
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
          if (state is! SwipeStackLoaded || state.candidates.isEmpty) {
            return const Center(
              child: Text(
                'Sem candidatos por aqui agora.',
                style: TextStyle(color: VibeMatchColors.textLow),
              ),
            );
          }

          final candidates = state.candidates;
          return Padding(
            padding: const EdgeInsets.all(16),
            child: CardSwiper(
              controller: _controller,
              cardsCount: candidates.length,
              numberOfCardsDisplayed:
                  candidates.length < 3 ? candidates.length : 3,
              onSwipe: (previousIndex, currentIndex, direction) =>
                  _onSwipe(previousIndex, currentIndex, direction, candidates),
              cardBuilder: (context, index, _, __) =>
                  SwipeCard(candidate: candidates[index]),
            ),
          );
        },
      ),
    );
  }
}
