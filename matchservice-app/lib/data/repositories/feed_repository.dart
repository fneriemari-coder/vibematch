import '../../core/api/dio_client.dart';
import '../models/feed_models.dart';

class FeedRepository {
  FeedRepository(this._client);

  final DioClient _client;

  Future<DiscoveryFeedPage> discover({double? lat, double? lng, int limit = 20, String? cursor}) async {
    final response = await _client.dio.get('/feed/discover', queryParameters: {
      if (lat != null) 'lat': lat,
      if (lng != null) 'lng': lng,
      'limit': limit,
      if (cursor != null) 'cursor': cursor,
    });
    return DiscoveryFeedPage.fromJson(response.data as Map<String, dynamic>);
  }

  Future<AiTranslateResult> translateIntent(String rawInput, {double? lat, double? lng}) async {
    final response = await _client.dio.post('/ai/translate', data: {
      'rawInput': rawInput,
      if (lat != null) 'lat': lat,
      if (lng != null) 'lng': lng,
    });
    return AiTranslateResult.fromJson(response.data as Map<String, dynamic>);
  }
}
