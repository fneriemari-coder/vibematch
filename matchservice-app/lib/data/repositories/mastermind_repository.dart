import '../../core/api/dio_client.dart';
import '../models/mastermind_models.dart';

class MastermindRepository {
  MastermindRepository(this._client);

  final DioClient _client;

  Future<List<MastermindSession>> listUpcoming({int limit = 20, int offset = 0}) async {
    final response = await _client.dio.get('/mastermind/sessions', queryParameters: {
      'limit': limit,
      'offset': offset,
    });
    return (response.data as List)
        .map((e) => MastermindSession.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Opens a Stripe Checkout session for the access fee — the booking itself
  /// is only created once the webhook confirms real payment (see
  /// mastermind.service.ts completeBooking).
  Future<String?> bookSession(String sessionId) async {
    final response = await _client.dio.post('/mastermind/sessions/$sessionId/book');
    return (response.data as Map<String, dynamic>)['checkoutUrl'] as String?;
  }

  /// Throws (403/400) if the caller hasn't booked, the window isn't open
  /// yet, or the host hasn't published a stream link — the screen should
  /// surface the server's message rather than guessing why access failed.
  Future<MastermindAccess> getAccess(String sessionId) async {
    final response = await _client.dio.get('/mastermind/sessions/$sessionId/access');
    return MastermindAccess.fromJson(response.data as Map<String, dynamic>);
  }
}
