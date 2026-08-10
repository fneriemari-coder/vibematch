import '../../core/api/dio_client.dart';
import '../models/feed_models.dart';
import '../models/user_models.dart';

class SwipeRepository {
  SwipeRepository(this._client);

  final DioClient _client;

  Future<List<SwipeCandidate>> getStack({
    required SwipeMode mode,
    double? lat,
    double? lng,
    double radiusKm = 25,
    int limit = 20,
  }) async {
    final response = await _client.dio.get(
      '/swipes/stack',
      queryParameters: {
        'mode': mode.apiValue,
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
        'radiusKm': radiusKm,
        'limit': limit,
      },
    );
    return (response.data as List)
        .map((e) => SwipeCandidate.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Returns the raw swipe response (`{swipe, match, alreadySwiped}`) so the
  /// UI can react to a fresh match (e.g. trigger the success animation).
  Future<Map<String, dynamic>> swipe({
    required String swipedId,
    required bool like,
    required SwipeMode mode,
  }) async {
    // 402 Payment Required (FREE-tier daily cap) surfaces as a DioException
    // with response.statusCode == 402 — callers should catch it and route to
    // PaywallScreen rather than treating it as a generic error.
    final response = await _client.dio.post(
      '/swipes',
      data: {
        'swipedId': swipedId,
        'direction': like ? 'LIKE' : 'DISLIKE',
        'mode': mode.apiValue,
      },
    );
    return response.data as Map<String, dynamic>;
  }

  Future<List<dynamic>> listMyMatches() async {
    final response = await _client.dio.get('/swipes/matches');
    return response.data as List<dynamic>;
  }
}
