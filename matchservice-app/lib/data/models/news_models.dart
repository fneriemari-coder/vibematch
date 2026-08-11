/// Models for the curated business-news feed:
/// GET /feed/news, GET /feed/news/saved and the save/view side-effects.
///
/// This is the editorial half of the Discovery Feed — real articles, video and
/// academic papers pulled from outside publishers — as opposed to
/// `feed_models.dart`, which carries posts written by members.

/// Wire values of `NewsItem.category`, mapped to their accented Portuguese
/// display label. The API stores unaccented screaming snake case.
const Map<String, String> newsCategoryLabels = <String, String>{
  'ENGENHARIA': 'Engenharia',
  'MARKETING': 'Marketing',
  'FINANCAS': 'Finanças',
  'PUBLICIDADE': 'Publicidade',
  'TECNOLOGIA': 'Tecnologia',
  'GESTAO': 'Gestão',
  'EMPREENDEDORISMO': 'Empreendedorismo',
};

/// Falls back to the raw wire value so a category added on the backend before
/// this map catches up still renders as something rather than as a blank tag.
String newsCategoryLabel(String category) =>
    newsCategoryLabels[category] ?? category;

/// Wire values of `NewsItem.mediaKind`. Kept as constants rather than an enum
/// because they travel to the API verbatim as a query parameter, and an enum
/// would only add a mapping in both directions for no extra safety.
class NewsMediaKinds {
  NewsMediaKinds._();

  static const String article = 'ARTICLE';
  static const String video = 'VIDEO';
  static const String paper = 'PAPER';
}

const Map<String, String> newsMediaKindLabels = <String, String>{
  NewsMediaKinds.article: 'Notícia',
  NewsMediaKinds.video: 'Vídeo',
  NewsMediaKinds.paper: 'Tese',
};

String newsMediaKindLabel(String mediaKind) =>
    newsMediaKindLabels[mediaKind] ?? 'Notícia';

/// One item in the curated feed. Every string field defaults to empty rather
/// than to null: the cards ask "is this empty?" in a dozen places, and a single
/// nullability convention keeps that from turning into `?? ''` at every use.
class NewsItem {
  const NewsItem({
    required this.id,
    required this.title,
    required this.summary,
    required this.url,
    required this.imageUrl,
    required this.videoUrl,
    required this.author,
    required this.category,
    required this.mediaKind,
    required this.publishedAt,
    required this.sourceName,
    required this.sourceSiteUrl,
    required this.viewsCount,
    required this.saved,
  });

  final String id;
  final String title;
  final String summary;

  /// Canonical page on the publisher's site.
  final String url;

  /// Publisher-hosted image. Never load this directly on web — route it through
  /// `NewsRepository.proxiedImageUrl`, which sends it via our own origin so
  /// CanvasKit's XHR fetch is not blocked by the publisher's missing CORS
  /// headers.
  final String imageUrl;
  final String videoUrl;
  final String author;
  final String category;

  /// `ARTICLE` | `VIDEO` | `PAPER` — see [NewsMediaKinds].
  final String mediaKind;

  /// Null when the source did not publish a date; the dateline is then simply
  /// omitted rather than rendering an epoch.
  final DateTime? publishedAt;
  final String sourceName;
  final String sourceSiteUrl;
  final int viewsCount;

  /// Whether the signed-in member has bookmarked this item.
  final bool saved;

  bool get isVideo => mediaKind == NewsMediaKinds.video;
  bool get isPaper => mediaKind == NewsMediaKinds.paper;

  String get categoryLabel => newsCategoryLabel(category);
  String get mediaKindLabel => newsMediaKindLabel(mediaKind);

  /// Where a tap should land: the clip for a video, the article otherwise, with
  /// the publisher's home page as the last resort so a card is never inert.
  String get targetUrl {
    if (isVideo && videoUrl.isNotEmpty) return videoUrl;
    if (url.isNotEmpty) return url;
    return sourceSiteUrl;
  }

  /// Only `saved` ever changes client-side (the optimistic bookmark toggle), so
  /// that is the only field this copies over.
  NewsItem copyWith({bool? saved}) => NewsItem(
        id: id,
        title: title,
        summary: summary,
        url: url,
        imageUrl: imageUrl,
        videoUrl: videoUrl,
        author: author,
        category: category,
        mediaKind: mediaKind,
        publishedAt: publishedAt,
        sourceName: sourceName,
        sourceSiteUrl: sourceSiteUrl,
        viewsCount: viewsCount,
        saved: saved ?? this.saved,
      );

  factory NewsItem.fromJson(Map<String, dynamic> json) => NewsItem(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        summary: json['summary'] as String? ?? '',
        url: json['url'] as String? ?? '',
        imageUrl: json['imageUrl'] as String? ?? '',
        videoUrl: json['videoUrl'] as String? ?? '',
        author: json['author'] as String? ?? '',
        category: json['category'] as String? ?? '',
        mediaKind: json['mediaKind'] as String? ?? NewsMediaKinds.article,
        publishedAt: DateTime.tryParse('${json['publishedAt'] ?? ''}'),
        sourceName: json['sourceName'] as String? ?? '',
        sourceSiteUrl: json['sourceSiteUrl'] as String? ?? '',
        viewsCount: int.tryParse('${json['viewsCount'] ?? 0}') ?? 0,
        saved: json['saved'] as bool? ?? false,
      );
}

/// Cursor-paginated page of [NewsItem]s. `nextCursor` is opaque — pass it back
/// verbatim on the next request; null means the feed is exhausted.
class NewsPage {
  const NewsPage({
    required this.items,
    required this.nextCursor,
    required this.categories,
  });

  final List<NewsItem> items;
  final String? nextCursor;

  /// The categories that actually have items, so the filter row never offers a
  /// chip that returns nothing.
  final List<String> categories;

  factory NewsPage.fromJson(Map<String, dynamic> json) => NewsPage(
        items: (json['items'] as List? ?? const [])
            .map((e) => NewsItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        nextCursor: json['nextCursor'] as String?,
        categories:
            (json['categories'] as List? ?? const []).map((e) => '$e').toList(),
      );
}
