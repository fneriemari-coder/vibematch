/// Models for GET /content/articles, GET /content/articles/:slug and the two
/// POST endpoints behind the compose sheet (hand-written vs AI-generated).

/// Wire values of `Article.category`, mapped to their accented Portuguese
/// display label — the API stores unaccented screaming snake case.
const Map<String, String> contentCategoryLabels = <String, String>{
  'GESTAO': 'Gestão',
  'VENDAS': 'Vendas',
  'LIDERANCA': 'Liderança',
  'ESTRATEGIA': 'Estratégia',
  'MARKETING': 'Marketing',
  'FINANCAS': 'Finanças',
  'TECNOLOGIA': 'Tecnologia',
  'CARREIRA': 'Carreira',
};

/// Falls back to the raw wire value so a category added on the backend before
/// this map catches up still renders as something rather than as a blank tag.
String contentCategoryLabel(String category) =>
    contentCategoryLabels[category] ?? category;

/// The card shape — shared by the list endpoint, the `related` rail on a
/// detail response, and whatever the two POST endpoints echo back.
class ArticleCard {
  const ArticleCard({
    required this.id,
    required this.slug,
    required this.title,
    required this.excerpt,
    required this.coverImageUrl,
    required this.category,
    required this.readMinutes,
    required this.authorName,
    required this.authorId,
    required this.aiGenerated,
    required this.publishedAt,
    required this.viewCount,
  });

  final String id;
  final String slug;
  final String title;
  final String excerpt;
  final String? coverImageUrl;
  final String category;
  final int readMinutes;
  final String authorName;
  final String authorId;
  final bool aiGenerated;

  /// Null while an article is still a draft — the dateline is simply omitted
  /// rather than rendering an epoch date.
  final DateTime? publishedAt;
  final int viewCount;

  String get categoryLabel => contentCategoryLabel(category);

  factory ArticleCard.fromJson(Map<String, dynamic> json) => ArticleCard(
        id: json['id'] as String? ?? '',
        slug: json['slug'] as String? ?? '',
        title: json['title'] as String? ?? '',
        excerpt: json['excerpt'] as String? ?? '',
        coverImageUrl: json['coverImageUrl'] as String?,
        category: json['category'] as String? ?? '',
        readMinutes: int.tryParse('${json['readMinutes'] ?? 0}') ?? 0,
        authorName: json['authorName'] as String? ?? '',
        authorId: json['authorId'] as String? ?? '',
        aiGenerated: json['aiGenerated'] as bool? ?? false,
        publishedAt: DateTime.tryParse('${json['publishedAt'] ?? ''}'),
        viewCount: int.tryParse('${json['viewCount'] ?? 0}') ?? 0,
      );
}

/// GET /content/articles/:slug — the card fields plus the markdown body and a
/// "Leia também" rail.
class ArticleDetail {
  const ArticleDetail({
    required this.article,
    required this.body,
    required this.related,
  });

  final ArticleCard article;
  final String body;
  final List<ArticleCard> related;

  factory ArticleDetail.fromJson(Map<String, dynamic> json) => ArticleDetail(
        article: ArticleCard.fromJson(json),
        body: json['body'] as String? ?? '',
        related: (json['related'] as List? ?? const [])
            .map((e) => ArticleCard.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class ArticlePage {
  const ArticlePage({
    required this.articles,
    required this.total,
    required this.categories,
    required this.limit,
    required this.offset,
  });

  final List<ArticleCard> articles;
  final int total;

  /// The categories that actually have published articles — the filter row is
  /// built from these rather than from the full enum, so it never offers a
  /// filter that returns nothing.
  final List<String> categories;
  final int limit;
  final int offset;

  factory ArticlePage.fromJson(Map<String, dynamic> json) => ArticlePage(
        articles: (json['articles'] as List? ?? const [])
            .map((e) => ArticleCard.fromJson(e as Map<String, dynamic>))
            .toList(),
        total: int.tryParse('${json['total'] ?? 0}') ?? 0,
        categories: (json['categories'] as List?)?.cast<String>() ?? const [],
        limit: int.tryParse('${json['limit'] ?? 20}') ?? 20,
        offset: int.tryParse('${json['offset'] ?? 0}') ?? 0,
      );
}
