import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/api/dio_client.dart';
import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../data/models/feed_models.dart';
import '../../data/models/news_models.dart';
import '../../data/repositories/feed_repository.dart';
import '../../data/repositories/media_repository.dart';
import '../../data/repositories/news_repository.dart';
import '../../data/repositories/post_repository.dart';
import '../../logic/feed/feed_cubit.dart';
import '../../logic/swipe/swipe_cubit.dart';
import '../widgets/discovery_post_card.dart';
import '../widgets/news_card.dart';
import '../widgets/vibe_ui.dart';
import 'create_post_screen.dart';
import 'saved_news_screen.dart';
import 'swipe_deck_screen.dart';

/// The lanes of the segmented control.
///
/// `all` is the default and the point of the screen: a member waiting on a
/// professional to answer should be able to scroll one place and see the whole
/// business world — publisher journalism, video, research and the voices of
/// other members — rather than five near-empty sections.
enum _FeedLane { all, news, video, paper, community }

extension on _FeedLane {
  String get label => switch (this) {
        _FeedLane.all => 'Tudo',
        _FeedLane.news => 'Notícias',
        _FeedLane.video => 'Vídeos',
        _FeedLane.paper => 'Teses',
        _FeedLane.community => 'Da comunidade',
      };

  IconData get icon => switch (this) {
        _FeedLane.all => Icons.auto_awesome_motion_rounded,
        _FeedLane.news => Icons.newspaper_rounded,
        _FeedLane.video => Icons.play_circle_outline_rounded,
        _FeedLane.paper => Icons.menu_book_rounded,
        _FeedLane.community => Icons.groups_rounded,
      };

  /// The `mediaKind` query parameter this lane filters on; null means "any".
  String? get mediaKind => switch (this) {
        _FeedLane.news => NewsMediaKinds.article,
        _FeedLane.video => NewsMediaKinds.video,
        _FeedLane.paper => NewsMediaKinds.paper,
        _FeedLane.all || _FeedLane.community => null,
      };

  bool get showsNews => this != _FeedLane.community;

  /// Member posts appear woven into the mixed lane and alone in their own.
  bool get showsPosts => this == _FeedLane.all || this == _FeedLane.community;
}

/// One row of the rendered list — either a curated item or a member post. The
/// two are deliberately the same list rather than two stacked sections, because
/// a feed that segregates them stops reading as one place.
sealed class _Entry {
  const _Entry();
}

class _NewsEntry extends _Entry {
  const _NewsEntry(this.item);
  final NewsItem item;
}

class _PostEntry extends _Entry {
  const _PostEntry(this.item);
  final DiscoveryFeedItem item;
}

/// The Discovery Feed: an endless, image-first stream of engineering,
/// marketing, finance, advertising, technology and management — news, video and
/// research — with the community's own posts woven through it.
class DiscoveryFeedScreen extends StatefulWidget {
  const DiscoveryFeedScreen({
    super.key,
    this.focusPostId,
    this.newsRepository,
  });

  /// Set when a push notification opened the feed at a specific member post:
  /// the screen starts on the community lane with that post first.
  final String? focusPostId;

  /// Injected by tests; in the app the screen builds its own from the ambient
  /// [DioClient], because `main.dart` does not register this repository.
  final NewsRepository? newsRepository;

  @override
  State<DiscoveryFeedScreen> createState() => _DiscoveryFeedScreenState();
}

class _DiscoveryFeedScreenState extends State<DiscoveryFeedScreen> {
  final ScrollController _scroll = ScrollController();
  final TextEditingController _searchController = TextEditingController();

  late final NewsRepository _news;
  late final FeedCubit _feed;

  /// Non-null only when this screen created the cubit itself (deep link) and is
  /// therefore responsible for closing it.
  FeedCubit? _ownedFeed;

  late _FeedLane _lane;

  /// Null means "Todos".
  String? _category;

  /// Captured from the first unfiltered response: filtering narrows the
  /// server's `categories` to whatever matched, which would otherwise make the
  /// rest of the chip row vanish the moment you use it.
  List<String> _categories = const [];

  final List<NewsItem> _items = [];
  String _query = '';
  String? _cursor;
  bool _hasMore = true;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  /// Guards against an in-flight page landing after the filters moved on and
  /// appending items that no longer belong to the visible lane.
  int _requestId = 0;

  @override
  void initState() {
    super.initState();
    _lane = widget.focusPostId != null ? _FeedLane.community : _FeedLane.all;
    _news = widget.newsRepository ?? NewsRepository(context.read<DioClient>());

    // AppShell provides the cubit for the tab. The `/discovery-feed` deep link
    // in main.dart pushes this screen from the root navigator, where there is
    // none — owning one in that case keeps the notification tap working
    // without making the tab pay for a second cubit.
    FeedCubit? ambient;
    try {
      ambient = context.read<FeedCubit>();
    } catch (_) {
      ambient = null;
    }
    if (ambient == null) {
      _ownedFeed = FeedCubit(context.read<FeedRepository>());
      _feed = _ownedFeed!;
    } else {
      _feed = ambient;
    }
    if (_feed.state is FeedInitial) _feed.loadInitial();

    _scroll.addListener(_onScroll);
    _loadNews(reset: true);
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _searchController.dispose();
    _ownedFeed?.close();
    super.dispose();
  }

  // --- Data ---------------------------------------------------------------

  void _onScroll() {
    if (!_scroll.hasClients) return;
    final position = _scroll.position;
    // Start the next page a full screen before the end so the spinner is a
    // reassurance rather than a wait.
    if (position.maxScrollExtent - position.pixels > 600) return;
    if (_lane.showsNews) _loadNews(reset: false);
    if (_lane.showsPosts) _feed.loadMore();
  }

  Future<void> _loadNews({required bool reset}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      if (_loading || _loadingMore || !_hasMore || _cursor == null) return;
      setState(() => _loadingMore = true);
    }

    final requestId = ++_requestId;
    try {
      final page = await _news.listNews(
        category: _category,
        mediaKind: _lane.mediaKind,
        search: _query,
        cursor: reset ? null : _cursor,
      );
      if (!mounted || requestId != _requestId) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
        if (page.categories.isNotEmpty &&
            (_categories.isEmpty || (_category == null && _query.isEmpty))) {
          _categories = page.categories;
        }
        _loading = false;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _loading = false;
        _loadingMore = false;
        if (reset) {
          _error = describeApiError(
            error,
            fallback: 'Não foi possível carregar o feed agora.',
          );
        } else {
          // Stop hammering the same failing page on every scroll frame — the
          // pull to refresh is the way back.
          _hasMore = false;
        }
      });
      if (reset) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível carregar mais conteúdo.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _refresh() async {
    await Future.wait([_loadNews(reset: true), _feed.loadInitial()]);
  }

  void _selectLane(_FeedLane lane) {
    if (_lane == lane) return;
    setState(() => _lane = lane);
    if (lane.showsNews) _loadNews(reset: true);
  }

  void _selectCategory(String? category) {
    if (_category == category) return;
    setState(() => _category = category);
    _loadNews(reset: true);
  }

  void _submitSearch(String value) {
    final query = value.trim();
    if (query == _query) return;
    setState(() => _query = query);
    if (_lane == _FeedLane.community) {
      // Searching is a request to see published material, not member posts.
      setState(() => _lane = _FeedLane.all);
    }
    _loadNews(reset: true);
  }

  /// Optimistic bookmark: the icon flips on the tap and reverts if the server
  /// disagrees, because a bookmark that waits on a round trip feels broken.
  Future<void> _toggleSave(NewsItem item) async {
    final index = _items.indexWhere((e) => e.id == item.id);
    if (index < 0) return;
    final next = !item.saved;
    setState(() => _items[index] = item.copyWith(saved: next));
    try {
      if (next) {
        await _news.save(item.id);
      } else {
        await _news.unsave(item.id);
      }
    } catch (error) {
      if (!mounted) return;
      final revertIndex = _items.indexWhere((e) => e.id == item.id);
      if (revertIndex >= 0) {
        setState(
          () =>
              _items[revertIndex] = _items[revertIndex].copyWith(saved: !next),
        );
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: next
                  ? 'Não foi possível salvar este item.'
                  : 'Não foi possível remover dos salvos.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _openItem(NewsItem item) async {
    // Fire-and-forget: a failed view ping must never block the link.
    _news.markViewed(item.id).catchError((Object _) {});
    final opened = await openNewsUrl(item.targetUrl);
    if (opened || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Não foi possível abrir este conteúdo.')),
    );
  }

  // --- Navigation ---------------------------------------------------------

  void _openSaved() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SavedNewsScreen(newsRepository: _news),
      ),
    );
  }

  void _openComposer() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CreatePostScreen(
          postRepository: context.read<PostRepository>(),
          mediaRepository: context.read<MediaRepository>(),
        ),
      ),
    );
  }

  void _onImplement(DiscoveryFeedItem item) {
    Navigator.of(context).push(
      PageRouteBuilder<void>(
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

  void _showAiResultSheet(BuildContext context, AiTranslateResult result) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: VibeMatchColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(VibeMatchRadii.card),
        ),
      ),
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('A IA entendeu isso:', style: VibeMatchTextStyles.heading),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final need in result.interpretedNeeds)
                  VibeTag(label: need),
              ],
            ),
            const SizedBox(height: 22),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.of(sheetContext).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
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
            ),
          ],
        ),
      ),
    );
  }

  // --- Composition --------------------------------------------------------

  List<DiscoveryFeedItem> _postsOf(FeedState state) {
    final posts = switch (state) {
      FeedLoaded(:final items) => items,
      FeedLoading(:final items) => items,
      FeedAiThinking(:final items) => items,
      FeedAiResult(:final items) => items,
      _ => const <DiscoveryFeedItem>[],
    };
    final focusId = widget.focusPostId;
    if (focusId == null) return posts;
    final index = posts.indexWhere((post) => post.postId == focusId);
    if (index <= 0) return posts;
    // The post the notification was about belongs at the top, not wherever the
    // ranking happened to put it.
    return [posts[index], ...posts]..removeAt(index + 1);
  }

  List<_Entry> _entries(List<DiscoveryFeedItem> posts) {
    if (_lane == _FeedLane.community) {
      return [for (final post in posts) _PostEntry(post)];
    }
    final entries = <_Entry>[];
    var postIndex = 0;
    for (var i = 0; i < _items.length; i++) {
      entries.add(_NewsEntry(_items[i]));
      // One community voice every fourth card in the mixed lane: often enough
      // that members see each other, rare enough that the journalism still
      // carries the scroll.
      if (_lane == _FeedLane.all &&
          (i + 1) % 4 == 0 &&
          postIndex < posts.length) {
        entries.add(_PostEntry(posts[postIndex++]));
      }
    }
    // Nothing curated matched, but the community still has something to say.
    if (_lane == _FeedLane.all && _items.isEmpty) {
      for (final post in posts) {
        entries.add(_PostEntry(post));
      }
    }
    return entries;
  }

  // --- Build --------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(
        title: const Text('Feed'),
        actions: [
          IconButton(
            tooltip: 'Salvos',
            onPressed: _openSaved,
            icon: const Icon(Icons.bookmark_border_rounded),
          ),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'feed-compose',
        onPressed: _openComposer,
        backgroundColor: VibeMatchColors.neonPrimary,
        foregroundColor: VibeMatchColors.ink,
        icon: const Icon(Icons.edit_rounded, size: 18),
        label: const Text('Publicar'),
      ),
      body: BlocConsumer<FeedCubit, FeedState>(
        bloc: _feed,
        listenWhen: (_, state) => state is FeedAiResult,
        listener: (context, state) {
          if (state is FeedAiResult) _showAiResultSheet(context, state.result);
        },
        builder: (context, state) {
          final posts = _postsOf(state);
          final entries = _entries(posts);

          return RefreshIndicator(
            onRefresh: _refresh,
            color: VibeMatchColors.neonPrimary,
            backgroundColor: VibeMatchColors.surface,
            child: CustomScrollView(
              controller: _scroll,
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverToBoxAdapter(
                  child: VibeContent(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 18),
                        const VibeSectionHeader(
                          eyebrow: 'Radar de negócios',
                          title: 'O que move o mercado',
                          titleAccent: 'agora',
                          subtitle: 'Notícias, vídeos e teses de engenharia, '
                              'marketing, finanças, publicidade e gestão — '
                              'mais o que a comunidade está publicando.',
                        ),
                        const SizedBox(height: 18),
                        _SearchField(
                          controller: _searchController,
                          thinking: state is FeedAiThinking,
                          onSubmit: _submitSearch,
                          onAsk: () {
                            final value = _searchController.text.trim();
                            if (value.isEmpty) return;
                            _feed.askAi(value);
                          },
                        ),
                        const SizedBox(height: 18),
                      ],
                    ),
                  ),
                ),
                SliverToBoxAdapter(
                  child: _LaneSelector(
                    selected: _lane,
                    onSelected: _selectLane,
                  ),
                ),
                if (_lane.showsNews && _categories.isNotEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 14),
                      child: _CategoryRow(
                        categories: _categories,
                        selected: _category,
                        onSelected: _selectCategory,
                      ),
                    ),
                  ),
                const SliverToBoxAdapter(child: SizedBox(height: 22)),
                ..._bodySlivers(state, posts, entries),
              ],
            ),
          );
        },
      ),
    );
  }

  List<Widget> _bodySlivers(
    FeedState state,
    List<DiscoveryFeedItem> posts,
    List<_Entry> entries,
  ) {
    final blocking = _blockingState(state, posts, entries);
    if (blocking != null) {
      return [SliverFillRemaining(hasScrollBody: false, child: blocking)];
    }

    return [
      SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) => Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: VibeContent(child: _buildEntry(entries[index])),
          ),
          childCount: entries.length,
        ),
      ),
      SliverToBoxAdapter(child: _Footer(loading: _footerLoading(state))),
    ];
  }

  bool _footerLoading(FeedState state) {
    if (_lane == _FeedLane.community) return state is FeedLoading;
    return _loadingMore || _hasMore;
  }

  /// The one full-screen state that replaces the list, if any: spinner, error
  /// or empty. Returns null when there is content to show.
  Widget? _blockingState(
    FeedState state,
    List<DiscoveryFeedItem> posts,
    List<_Entry> entries,
  ) {
    if (_lane == _FeedLane.community) {
      if (posts.isEmpty && state is FeedLoading) return const _Spinner();
      if (posts.isEmpty && state is FeedError) {
        return VibeErrorState(
          message: state.message,
          onRetry: _feed.loadInitial,
        );
      }
      if (posts.isEmpty) {
        return VibeEmptyState(
          icon: Icons.groups_rounded,
          title: 'A comunidade ainda está começando',
          message: 'Publique o primeiro caso do seu negócio e apareça para '
              'quem procura um profissional como você.',
          action: ElevatedButton(
            onPressed: _openComposer,
            child: const Text('Publicar agora'),
          ),
        );
      }
      return null;
    }

    if (_loading && _items.isEmpty) return const _Spinner();
    if (_error != null && _items.isEmpty) {
      return VibeErrorState(
        message: _error!,
        onRetry: () => _loadNews(reset: true),
      );
    }
    if (entries.isEmpty) return _emptyNews();
    return null;
  }

  Widget _emptyNews() {
    if (_query.isNotEmpty) {
      return VibeEmptyState(
        icon: Icons.search_off_rounded,
        title: 'Nada encontrado para "$_query"',
        message: 'Tente outras palavras, ou peça à IA para traduzir a sua '
            'necessidade em profissionais.',
        action: OutlinedButton(
          onPressed: () {
            _searchController.clear();
            _submitSearch('');
          },
          child: const Text('Limpar busca'),
        ),
      );
    }
    if (_category != null) {
      return VibeEmptyState(
        icon: Icons.newspaper_rounded,
        title: 'Ainda nada em ${newsCategoryLabel(_category!)}',
        message: 'Estamos publicando novas matérias desta editoria ao longo '
            'do dia. Escolha outra categoria enquanto isso.',
        action: OutlinedButton(
          onPressed: () => _selectCategory(null),
          child: const Text('Ver tudo'),
        ),
      );
    }
    return VibeEmptyState(
      icon: Icons.rss_feed_rounded,
      title: 'O feed ainda está sendo abastecido',
      message: 'Estamos reunindo as notícias, os vídeos e as teses de '
          'engenharia, marketing, finanças, publicidade e gestão do dia. '
          'Atualize em instantes — o conteúdo chega em blocos.',
      action: ElevatedButton(
        onPressed: _refresh,
        child: const Text('Atualizar'),
      ),
    );
  }

  Widget _buildEntry(_Entry entry) {
    return switch (entry) {
      _NewsEntry(:final item) => NewsFeedCard(
          item: item,
          imageUrl: _news.proxiedImageUrl(item.imageUrl),
          onOpen: () => _openItem(item),
          onToggleSave: () => _toggleSave(item),
        ),
      _PostEntry(:final item) => _CommunitySlot(
          item: item,
          onImplement: () => _onImplement(item),
        ),
    };
  }
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/// Search plus the AI translator on one line. The text box filters the curated
/// feed; the gold spark hands the same sentence to /ai/translate, which is the
/// shortcut from "here is my problem" to a deck of professionals.
class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.thinking,
    required this.onSubmit,
    required this.onAsk,
  });

  final TextEditingController controller;
  final bool thinking;
  final ValueChanged<String> onSubmit;
  final VoidCallback onAsk;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      textInputAction: TextInputAction.search,
      style: VibeMatchTextStyles.body.copyWith(
        color: VibeMatchColors.textHigh,
      ),
      onSubmitted: onSubmit,
      decoration: InputDecoration(
        hintText: 'Buscar no feed — ou descreva sua dor para a IA',
        prefixIcon: const Icon(
          Icons.search_rounded,
          size: 20,
          color: VibeMatchColors.textLow,
        ),
        suffixIcon: thinking
            ? const Padding(
                padding: EdgeInsets.all(14),
                child: SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: VibeMatchColors.neonPrimary,
                  ),
                ),
              )
            : IconButton(
                tooltip: 'Traduzir com a IA',
                onPressed: onAsk,
                icon: const Icon(
                  Icons.auto_awesome_rounded,
                  color: VibeMatchColors.neonPrimary,
                ),
              ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 14,
        ),
      ),
    );
  }
}

/// The five lanes, as a horizontally scrolling set of pills — five labels never
/// fit across a phone, and a dropdown would hide the shape of the feed.
class _LaneSelector extends StatelessWidget {
  const _LaneSelector({required this.selected, required this.onSelected});

  final _FeedLane selected;
  final ValueChanged<_FeedLane> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: VibeMatchSpacing.gutter,
        ),
        itemCount: _FeedLane.values.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final lane = _FeedLane.values[index];
          final active = lane == selected;
          return _Pill(
            active: active,
            onTap: () => onSelected(lane),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  lane.icon,
                  size: 15,
                  color: active ? VibeMatchColors.ink : VibeMatchColors.textLow,
                ),
                const SizedBox(width: 7),
                Text(
                  lane.label,
                  style: VibeMatchTextStyles.caption.copyWith(
                    fontWeight: FontWeight.w700,
                    color:
                        active ? VibeMatchColors.ink : VibeMatchColors.textHigh,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// "Todos" first, then whatever categories the API says it actually has.
class _CategoryRow extends StatelessWidget {
  const _CategoryRow({
    required this.categories,
    required this.selected,
    required this.onSelected,
  });

  final List<String> categories;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: VibeMatchSpacing.gutter,
        ),
        itemCount: categories.length + 1,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final category = index == 0 ? null : categories[index - 1];
          final active = selected == category;
          return _Pill(
            active: active,
            onTap: () => onSelected(category),
            child: Text(
              category == null ? 'Todos' : newsCategoryLabel(category),
              style: VibeMatchTextStyles.caption.copyWith(
                fontWeight: FontWeight.w700,
                color: active ? VibeMatchColors.ink : VibeMatchColors.textHigh,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Shared pill. The fill and border cross-fade rather than snapping, which is
/// what makes the filter row feel like a control instead of a redraw.
class _Pill extends StatelessWidget {
  const _Pill({
    required this.active,
    required this.onTap,
    required this.child,
  });

  final bool active;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        color: active ? VibeMatchColors.neonPrimary : VibeMatchColors.surface,
        borderRadius: VibeMatchRadii.pillRadius,
        border: Border.all(
          color: active ? VibeMatchColors.neonPrimary : VibeMatchColors.border,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: VibeMatchRadii.pillRadius,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 15),
            child: Center(child: child),
          ),
        ),
      ),
    );
  }
}

/// A member post, framed so it reads as one card in the stream rather than as
/// the full-screen slide it was written for.
class _CommunitySlot extends StatelessWidget {
  const _CommunitySlot({required this.item, required this.onImplement});

  final DiscoveryFeedItem item;
  final VoidCallback onImplement;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const VibeTag(
              label: 'Da comunidade',
              icon: Icons.groups_rounded,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                item.creatorName,
                style: VibeMatchTextStyles.caption,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: VibeMatchRadii.cardRadius,
          child: SizedBox(
            height: 440,
            child: DiscoveryPostCard(
              item: item,
              // Nothing autoplays in a scrolling list — a dozen videos
              // competing for bandwidth is how a feed stops scrolling
              // smoothly. Tapping through opens the post full-screen.
              isActive: false,
              onImplement: onImplement,
            ),
          ),
        ),
      ],
    );
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: CircularProgressIndicator(color: VibeMatchColors.neonPrimary),
    );
  }
}

/// Footer of the infinite list: a spinner while another page is on the way,
/// and an explicit end marker once there is nothing left, so the scroll stops
/// somewhere deliberate.
class _Footer extends StatelessWidget {
  const _Footer({required this.loading});

  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 6, 0, 96),
      child: Center(
        child: loading
            ? const SizedBox(
                height: 22,
                width: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: VibeMatchColors.neonPrimary,
                ),
              )
            : Text(
                'Você chegou ao fim por enquanto. Puxe para atualizar.',
                textAlign: TextAlign.center,
                style: VibeMatchTextStyles.caption,
              ),
      ),
    );
  }
}
