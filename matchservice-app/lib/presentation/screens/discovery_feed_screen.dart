import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../data/models/feed_models.dart';
import '../../logic/feed/feed_cubit.dart';
import '../../logic/swipe/swipe_cubit.dart';
import '../../data/repositories/media_repository.dart';
import '../../data/repositories/post_repository.dart';
import '../widgets/discovery_post_card.dart';
import 'create_post_screen.dart';
import 'swipe_deck_screen.dart';

/// TikTok-style infinite vertical feed. The AI search bar up top hits
/// /ai/translate with a "thinking" animation, and each post's "Implementar
/// no meu Negócio" CTA jumps into a tag-filtered swipe deck with a
/// fade/slide transition.
class DiscoveryFeedScreen extends StatefulWidget {
  const DiscoveryFeedScreen({super.key, this.focusPostId});

  final String? focusPostId;

  @override
  State<DiscoveryFeedScreen> createState() => _DiscoveryFeedScreenState();
}

class _DiscoveryFeedScreenState extends State<DiscoveryFeedScreen> {
  final _pageController = PageController();
  final _searchController = TextEditingController();
  int _activeIndex = 0;

  @override
  void initState() {
    super.initState();
    context.read<FeedCubit>().loadInitial();
  }

  @override
  void dispose() {
    _pageController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _onImplement(DiscoveryFeedItem item) {
    Navigator.of(context).push(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 350),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween(
              begin: const Offset(0, 0.08),
              end: Offset.zero,
            ).animate(animation),
            child: BlocProvider(
              create: (context) => SwipeCubit(context.read())
                ..loadStackForTag(
                  skillTagId: item.skillTagId,
                  mode: item.source == 'LOCAL'
                      ? SwipeMode.local
                      : SwipeMode.cloud,
                ),
              child: const SwipeDeckScreen(),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      // CreatePostScreen was written but nothing ever opened it, so the feed
      // was read-only in practice — this is the composer's only entry point.
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CreatePostScreen(
              postRepository: context.read<PostRepository>(),
              mediaRepository: context.read<MediaRepository>(),
            ),
          ),
        ),
        backgroundColor: VibeMatchColors.neonPrimary,
        foregroundColor: VibeMatchColors.ink,
        icon: const Icon(Icons.edit_rounded, size: 18),
        label: const Text('Publicar'),
      ),
      body: Stack(
        children: [
          BlocBuilder<FeedCubit, FeedState>(
            builder: (context, state) {
              final items = switch (state) {
                FeedLoaded(:final items) => items,
                FeedLoading(:final items) => items,
                FeedAiThinking(:final items) => items,
                FeedAiResult(:final items) => items,
                _ => const <DiscoveryFeedItem>[],
              };

              if (items.isEmpty && state is FeedLoading) {
                return const Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                );
              }
              if (items.isEmpty) {
                return const Center(
                  child: Text(
                    'Nenhum conteúdo por aqui ainda.',
                    style: TextStyle(color: VibeMatchColors.textLow),
                  ),
                );
              }

              return PageView.builder(
                controller: _pageController,
                scrollDirection: Axis.vertical,
                itemCount: items.length,
                onPageChanged: (index) {
                  setState(() => _activeIndex = index);
                  if (index >= items.length - 3) {
                    context.read<FeedCubit>().loadMore();
                  }
                },
                itemBuilder: (context, index) => DiscoveryPostCard(
                  item: items[index],
                  isActive: index == _activeIndex,
                  onImplement: () => _onImplement(items[index]),
                ),
              );
            },
          ),
          _buildAiSearchBar(),
        ],
      ),
    );
  }

  Widget _buildAiSearchBar() {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: BlocConsumer<FeedCubit, FeedState>(
          listenWhen: (_, state) => state is FeedAiResult,
          listener: (context, state) {
            if (state is FeedAiResult) {
              _showAiResultSheet(context, state.result);
            }
          },
          builder: (context, state) {
            final thinking = state is FeedAiThinking;
            return Material(
              color: const Color(0xFF16161A).withOpacity(0.85),
              borderRadius: BorderRadius.circular(28),
              child: TextField(
                controller: _searchController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 14,
                  ),
                  hintText: 'Descreva sua dor... a IA traduz em soluções',
                  hintStyle: const TextStyle(color: VibeMatchColors.textLow),
                  prefixIcon: thinking
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: VibeMatchColors.neonPrimary,
                            ),
                          ),
                        )
                      : const Icon(
                          Icons.auto_awesome,
                          color: VibeMatchColors.neonPrimary,
                        ),
                ),
                onSubmitted: (value) {
                  if (value.trim().isEmpty) return;
                  context.read<FeedCubit>().askAi(value.trim());
                },
              ),
            );
          },
        ),
      ),
    );
  }

  void _showAiResultSheet(BuildContext context, AiTranslateResult result) {
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
            Text('A IA entendeu isso:', style: VibeMatchTextStyles.heading),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: result.interpretedNeeds
                  .map(
                    (tag) => Chip(
                      label: Text(tag),
                      backgroundColor: VibeMatchColors.background,
                      labelStyle: const TextStyle(
                        color: VibeMatchColors.neonPrimary,
                      ),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                Navigator.of(sheetContext).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => BlocProvider(
                      create: (context) => SwipeCubit(context.read())
                        ..loadStack(
                          result.suggestedMode == 'LOCAL'
                              ? SwipeMode.local
                              : SwipeMode.cloud,
                        ),
                      child: const SwipeDeckScreen(),
                    ),
                  ),
                );
              },
              child: const Text('Ver profissionais recomendados'),
            ),
          ],
        ),
      ),
    );
  }
}
