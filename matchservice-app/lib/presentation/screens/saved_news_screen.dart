import 'package:flutter/material.dart';

import '../../core/theme/vibe_match_theme.dart';
import '../../core/utils/api_error.dart';
import '../../data/models/news_models.dart';
import '../../data/repositories/news_repository.dart';
import '../widgets/news_card.dart';
import '../widgets/vibe_ui.dart';

/// Everything the member bookmarked, newest first — the reading list behind the
/// feed's save button. Same cards, so an item looks identical wherever it is
/// met.
class SavedNewsScreen extends StatefulWidget {
  const SavedNewsScreen({super.key, required this.newsRepository});

  final NewsRepository newsRepository;

  @override
  State<SavedNewsScreen> createState() => _SavedNewsScreenState();
}

class _SavedNewsScreenState extends State<SavedNewsScreen> {
  final ScrollController _scroll = ScrollController();
  final List<NewsItem> _items = [];

  String? _cursor;
  bool _hasMore = true;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _load();
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    final position = _scroll.position;
    if (position.maxScrollExtent - position.pixels > 600) return;
    _loadMore();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.newsRepository.listSaved();
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = describeApiError(
          error,
          fallback: 'Não foi possível carregar seus itens salvos.',
        );
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _loading || !_hasMore || _cursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.newsRepository.listSaved(cursor: _cursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingMore = false;
        // Stop asking for the same broken page on every scroll frame; the pull
        // to refresh is the way back.
        _hasMore = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível carregar mais itens salvos.',
            ),
          ),
        ),
      );
    }
  }

  /// Unsaving here removes the card — leaving a "salvo: não" row on a screen
  /// that exists only to list saved things would be nonsense. Restored in place
  /// if the request fails.
  Future<void> _unsave(NewsItem item) async {
    final index = _items.indexWhere((e) => e.id == item.id);
    if (index < 0) return;
    setState(() => _items.removeAt(index));
    try {
      await widget.newsRepository.unsave(item.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _items.insert(index.clamp(0, _items.length), item));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            describeApiError(
              error,
              fallback: 'Não foi possível remover dos salvos.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _open(NewsItem item) async {
    widget.newsRepository.markViewed(item.id).catchError((Object _) {});
    final opened = await openNewsUrl(item.targetUrl);
    if (opened || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Não foi possível abrir este conteúdo.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VibeMatchColors.background,
      appBar: AppBar(title: const Text('Salvos')),
      body: RefreshIndicator(
        onRefresh: _load,
        color: VibeMatchColors.neonPrimary,
        backgroundColor: VibeMatchColors.surface,
        child: CustomScrollView(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            const SliverToBoxAdapter(child: SizedBox(height: 18)),
            if (_loading)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: CircularProgressIndicator(
                    color: VibeMatchColors.neonPrimary,
                  ),
                ),
              )
            else if (_error != null)
              SliverFillRemaining(
                hasScrollBody: false,
                child: VibeErrorState(message: _error!, onRetry: _load),
              )
            else if (_items.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: VibeEmptyState(
                  icon: Icons.bookmark_border_rounded,
                  title: 'Nada salvo ainda',
                  message:
                      'Toque em "Salvar" em qualquer notícia, vídeo ou tese do '
                      'feed e ela fica guardada aqui para ler depois.',
                ),
              )
            else ...[
              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    final item = _items[index];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 18),
                      child: VibeContent(
                        child: NewsFeedCard(
                          item: item,
                          imageUrl: widget.newsRepository
                              .proxiedImageUrl(item.imageUrl),
                          onOpen: () => _open(item),
                          onToggleSave: () => _unsave(item),
                        ),
                      ),
                    );
                  },
                  childCount: _items.length,
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(0, 6, 0, 40),
                  child: Center(
                    child: _loadingMore
                        ? const SizedBox(
                            height: 22,
                            width: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: VibeMatchColors.neonPrimary,
                            ),
                          )
                        : Text(
                            'Você chegou ao fim da sua lista.',
                            style: VibeMatchTextStyles.caption,
                          ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
