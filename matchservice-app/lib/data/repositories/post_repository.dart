import 'package:dio/dio.dart';
import '../../core/api/dio_client.dart';

/// Thrown when POST /feed/post returns 422 (blocked by ai-moderator.service.ts).
class PostBlockedException implements Exception {
  PostBlockedException(this.reason);
  final String? reason;
}

class PostRepository {
  PostRepository(this._client);

  final DioClient _client;

  Future<String> createPost({
    required String title,
    required String contentText,
    String? mediaUrl,
    int? videoDurationSeconds,
    required List<String> tags,
  }) async {
    try {
      final response = await _client.dio.post(
        '/feed/post',
        data: {
          'title': title,
          'contentText': contentText,
          if (mediaUrl != null) 'mediaUrl': mediaUrl,
          if (videoDurationSeconds != null)
            'videoDurationSeconds': videoDurationSeconds,
          'tags': tags,
        },
      );
      return response.data['id'] as String;
    } on DioException catch (e) {
      if (e.response?.statusCode == 422) {
        throw PostBlockedException(e.response?.data?['reason']?.toString());
      }
      rethrow;
    }
  }
}
