import '../../core/api/dio_client.dart';
import '../models/mentorship_models.dart';

/// One-to-one mentorship: the offerings catalogue, booking a slot, and the
/// sessions the signed-in user has on both sides of the table.
class MentorshipRepository {
  MentorshipRepository(this._client);

  final DioClient _client;

  Future<MentorshipOfferingPage> listOfferings({
    String? search,
    String? mentorId,
    int limit = 20,
    int offset = 0,
  }) async {
    final response = await _client.dio.get(
      '/mentorship/offerings',
      queryParameters: {
        // Empty strings are dropped rather than sent — `?search=` filters on
        // the empty string, which matches nothing.
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (mentorId != null && mentorId.isNotEmpty) 'mentorId': mentorId,
        'limit': limit,
        'offset': offset,
      },
    );
    return MentorshipOfferingPage.fromJson(
      response.data as Map<String, dynamic>,
    );
  }

  /// Opens a checkout for the chosen slot. As with the masterminds, the
  /// booking itself only exists once the payment webhook confirms — so the
  /// caller's job is to open this URL, not to assume the session is booked.
  ///
  /// Returns null when the server answers without a URL, which the caller must
  /// treat as "checkout unavailable" rather than as success.
  Future<String?> book(String slotId) async {
    final response = await _client.dio.post('/mentorship/slots/$slotId/book');
    final data = response.data;
    if (data is Map) return data['checkoutUrl'] as String?;
    return null;
  }

  Future<MentorshipBookings> listBookings() async {
    final response = await _client.dio.get('/mentorship/bookings');
    return MentorshipBookings.fromJson(response.data as Map<String, dynamic>);
  }
}
