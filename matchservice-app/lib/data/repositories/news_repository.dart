import '../../core/api/dio_client.dart';
import '../models/news_models.dart';

/// The curated business-news feed: listing, the saved-items shelf, the bookmark
/// toggle, the view ping, and the one helper every card must use to load a
/// publisher image.
class NewsRepository {
  NewsRepository(this._client);

  final DioClient _client;

  Future<NewsPage> listNews({
    String? category,
    String? mediaKind,
    String? search,
    int limit = 20,
    String? cursor,
  }) async {
    final response = await _client.dio.get(
      '/feed/news',
      queryParameters: {
        // Empty strings are dropped rather than sent — `?category=` would be a
        // filter on the empty category, which matches nothing.
        if (category != null && category.isNotEmpty) 'category': category,
        if (mediaKind != null && mediaKind.isNotEmpty) 'mediaKind': mediaKind,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        'limit': limit,
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    return NewsPage.fromJson(response.data as Map<String, dynamic>);
  }

  Future<NewsPage> listSaved({int limit = 20, String? cursor}) async {
    final response = await _client.dio.get(
      '/feed/news/saved',
      queryParameters: {
        'limit': limit,
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    return NewsPage.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> save(String itemId) async {
    await _client.dio.post('/feed/news/$itemId/save');
  }

  Future<void> unsave(String itemId) async {
    await _client.dio.delete('/feed/news/$itemId/save');
  }

  /// Records that the member opened the item. Fire-and-forget at the call site:
  /// a failed ping must never stop the article from opening.
  Future<void> markViewed(String itemId) async {
    await _client.dio.post('/feed/news/$itemId/view');
  }

  /// The only sanctioned way to build an image URL for a feed card.
  ///
  /// Flutter web renders through CanvasKit, which fetches images over XHR and
  /// therefore enforces CORS. Publisher image hosts send no CORS headers, so a
  /// direct `<img>`/`CachedNetworkImage` load fails silently and the card is
  /// left with a hole — which is exactly why the feed looked empty. Routing
  /// through `/media/proxy` streams the bytes from our own origin instead.
  ///
  /// Returns an empty string when there is no image, so callers can test
  /// `isEmpty` rather than juggling nulls.
  String proxiedImageUrl(String? imageUrl) {
    if (imageUrl == null || imageUrl.isEmpty) return '';
    // Already ours (an upload, or a URL a previous pass proxied) — proxying a
    // proxy URL would double-encode it.
    if (imageUrl.startsWith('$_base/media/proxy')) return imageUrl;
    return '$_base/media/proxy?url=${Uri.encodeComponent(imageUrl)}';
  }

  /// The API origin without a trailing slash, so concatenation never produces
  /// a `//path`.
  String get _base {
    final base = _client.dio.options.baseUrl;
    return base.endsWith('/') ? base.substring(0, base.length - 1) : base;
  }
}
