import '../../core/api/dio_client.dart';
import '../models/escrow_models.dart';

/// The supervised-deal side of the platform: a match introduces two people,
/// an escrow project is the contract the platform actually holds money against.
class EscrowRepository {
  EscrowRepository(this._client);

  final DioClient _client;

  Future<List<EscrowProject>> listMine() async {
    final response = await _client.dio.get('/escrow');
    return (response.data as List)
        .map((e) => EscrowProject.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Opens a project against an existing SERVICE match. The server rejects
  /// B2B matches here — those open a partnership channel, not a paid contract.
  Future<void> create({
    required String matchId,
    required String clientId,
    required String providerId,
    required double budget,
    required String currency,
  }) async {
    await _client.dio.post(
      '/escrow',
      data: {
        'matchId': matchId,
        'clientId': clientId,
        'providerId': providerId,
        'budget': budget,
        'currency': currency,
      },
    );
  }

  /// Client deposits. Money moves into custody, not to the provider.
  ///
  /// Today the server settles the deposit itself and returns the updated
  /// project; once Stripe is wired in it will return a hosted checkout session
  /// instead and the client has to send the user there. Both shapes are
  /// accepted so the UI does not need a release to follow the backend: a
  /// checkout URL is returned when one is present, `null` when the deposit was
  /// already settled server-side.
  Future<String?> fund(String id) async {
    final response = await _client.dio.post('/escrow/$id/fund');
    return _checkoutUrlFrom(response.data);
  }

  /// Digs a checkout URL out of whatever the endpoint returned. Handles the
  /// flat `{checkoutUrl}` shape and the nested `{checkout: {url}}` one Stripe's
  /// own payloads use; anything else means "nothing to open".
  static String? _checkoutUrlFrom(Object? data) {
    if (data is! Map) return null;
    final candidates = <Object?>[
      data['checkoutUrl'],
      data['checkout_url'],
      if (data['checkout'] is Map) (data['checkout'] as Map)['url'],
    ];
    for (final candidate in candidates) {
      if (candidate is String && candidate.trim().isNotEmpty) {
        return candidate.trim();
      }
    }
    return null;
  }

  /// Client releases custody to the provider.
  Future<void> complete(String id) => _client.dio.post('/escrow/$id/complete');

  /// Either side freezes the funds pending review.
  Future<void> dispute(String id) => _client.dio.post('/escrow/$id/dispute');

  /// Only valid before funding — nothing has moved yet.
  Future<void> cancel(String id) => _client.dio.post('/escrow/$id/cancel');
}
