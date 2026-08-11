import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../data/repositories/academy_repository.dart';
import '../../data/repositories/chat_repository.dart';
import '../../data/repositories/community_repository.dart';
import '../../data/repositories/content_repository.dart';
import '../../data/repositories/mastermind_repository.dart';
import '../../logic/feed/feed_cubit.dart';
import 'content_screen.dart';
import 'conversations_screen.dart';
import 'courses_screen.dart';
import 'discovery_feed_screen.dart';
import 'home_toggle_screen.dart';
import 'mentors_screen.dart';

/// Signed-in shell.
///
/// Before this existed the app opened straight onto a three-button menu and
/// every other section — the academy, the mentoring side, the editorial hub —
/// had no entry point at all. The bottom bar is what makes them reachable.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;

  /// Tabs keep their scroll position and loaded data when you switch away and
  /// back, instead of refetching every time.
  final _tabKeys = List.generate(5, (_) => GlobalKey<NavigatorState>());

  void _goToTab(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    final tabs = [
      HomeToggleScreen(onNavigateToTab: _goToTab),
      // FeedCubit is not provided app-wide — it was never instantiated
      // anywhere, so the feed threw as soon as it was opened. It belongs to
      // this tab, so it is created here.
      BlocProvider(
        create: (context) => FeedCubit(context.read())..loadInitial(),
        child: const DiscoveryFeedScreen(),
      ),
      CoursesScreen(academyRepository: context.read<AcademyRepository>()),
      MentorsScreen(
        academyRepository: context.read<AcademyRepository>(),
        mastermindRepository: context.read<MastermindRepository>(),
        communityRepository: context.read<CommunityRepository>(),
      ),
      ContentScreen(contentRepository: context.read<ContentRepository>()),
    ];

    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      body: IndexedStack(
        index: _index,
        children: [
          for (var i = 0; i < tabs.length; i++)
            KeyedSubtree(key: _tabKeys[i], child: tabs[i]),
        ],
      ),
      floatingActionButton: _index == 0
          ? FloatingActionButton(
              heroTag: 'conversations',
              tooltip: 'Conversas',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => ConversationsScreen(
                    chatRepository: context.read<ChatRepository>(),
                  ),
                ),
              ),
              child: const Icon(Icons.forum_rounded),
            )
          : null,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: VibeMatchColors.border)),
        ),
        child: BottomNavigationBar(
          currentIndex: _index,
          onTap: _goToTab,
          selectedLabelStyle: VibeMatchTextStyles.caption.copyWith(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: VibeMatchColors.neonPrimary,
          ),
          unselectedLabelStyle: VibeMatchTextStyles.caption.copyWith(
            fontSize: 11,
          ),
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.home_outlined),
              activeIcon: Icon(Icons.home_rounded),
              label: 'Início',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.explore_outlined),
              activeIcon: Icon(Icons.explore_rounded),
              label: 'Feed',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.school_outlined),
              activeIcon: Icon(Icons.school_rounded),
              label: 'Cursos',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.groups_outlined),
              activeIcon: Icon(Icons.groups_rounded),
              label: 'Mentorias',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.article_outlined),
              activeIcon: Icon(Icons.article_rounded),
              label: 'Conteúdo',
            ),
          ],
        ),
      ),
    );
  }
}
