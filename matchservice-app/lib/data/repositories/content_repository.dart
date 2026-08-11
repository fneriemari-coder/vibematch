import '../../core/api/dio_client.dart';
import '../models/content_models.dart';

/// Editorial hub — the article list, a single article, and the two ways a
/// member can publish: writing it themselves or having the AI factory write it.
class ContentRepository {
  ContentRepository(this._client);

  final DioClient _client;

  Future<ArticlePage> listArticles({
    String? category,
    String? search,
    int limit = 20,
    int offset = 0,
  }) async {
    final response = await _client.dio.get(
      '/content/articles',
      queryParameters: {
        // Empty strings are dropped rather than sent — `?category=` would be a
        // filter on the empty category, which matches nothing.
        if (category != null && category.isNotEmpty) 'category': category,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        'limit': limit,
        'offset': offset,
      },
    );
    return ArticlePage.fromJson(response.data as Map<String, dynamic>);
  }

  Future<ArticleDetail> getArticle(String slug) async {
    final response = await _client.dio.get('/content/articles/$slug');
    return ArticleDetail.fromJson(response.data as Map<String, dynamic>);
  }

  Future<ArticleCard> createArticle({
    required String title,
    required String excerpt,
    required String body,
    required String category,
    String? coverImageUrl,
  }) async {
    final response = await _client.dio.post(
      '/content/articles',
      data: {
        'title': title,
        'excerpt': excerpt,
        'body': body,
        'category': category,
        if (coverImageUrl != null && coverImageUrl.isNotEmpty)
          'coverImageUrl': coverImageUrl,
      },
    );
    return ArticleCard.fromJson(response.data as Map<String, dynamic>);
  }

  /// The AI writes the whole piece from a topic; the response is the created
  /// article, so the caller can navigate straight to it.
  Future<ArticleCard> generateArticle({
    required String topic,
    required String category,
  }) async {
    final response = await _client.dio.post(
      '/content/generate-article',
      data: {'topic': topic, 'category': category},
    );
    return ArticleCard.fromJson(response.data as Map<String, dynamic>);
  }
}
