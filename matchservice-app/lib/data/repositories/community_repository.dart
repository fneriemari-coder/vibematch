import '../../core/api/dio_client.dart';
import '../models/community_models.dart';

class CommunityRepository {
  CommunityRepository(this._client);

  final DioClient _client;

  Future<List<Community>> listCommunities() async {
    final response = await _client.dio.get('/communities');
    final data = response.data as Map<String, dynamic>;
    return (data['communities'] as List? ?? const [])
        .map((e) => Community.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<CommunityDetail> getCommunity(String communityId) async {
    final response = await _client.dio.get('/communities/$communityId');
    return CommunityDetail.fromJson(response.data as Map<String, dynamic>);
  }

  /// Opens Stripe Checkout for the monthly fee. Throws a 400 with the server's
  /// own message when the caller is ineligible or the last seat has just gone —
  /// the screen surfaces that message rather than guessing.
  Future<String?> apply(String communityId) async {
    final response = await _client.dio.post(
      '/communities/$communityId/apply',
    );
    return (response.data as Map<String, dynamic>)['checkoutUrl'] as String?;
  }
}
