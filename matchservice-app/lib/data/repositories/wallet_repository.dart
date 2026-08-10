import '../../core/api/dio_client.dart';
import '../models/wallet_models.dart';

class WalletRepository {
  WalletRepository(this._client);

  final DioClient _client;

  Future<Map<String, dynamic>> advance(String escrowId) async {
    // 403 surfaces here if the caller isn't PRO_PROVIDER — see SubscriptionGuard.
    final response = await _client.dio.post('/wallet/advance', data: {'escrowId': escrowId});
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> withdraw(double amount) async {
    final response = await _client.dio.post('/wallet/withdraw', data: {'amount': amount});
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> financeProject(String escrowProjectId, {int installmentCount = 4}) async {
    final response = await _client.dio.post('/fintech/finance-project', data: {
      'escrowProjectId': escrowProjectId,
      'installmentCount': installmentCount,
    });
    return response.data as Map<String, dynamic>;
  }

  Future<List<dynamic>> myEscrowProjects() async {
    final response = await _client.dio.get('/escrow');
    return response.data as List<dynamic>;
  }

  Future<WalletTimeline> getTimeline() async {
    final response = await _client.dio.get('/wallet/timeline');
    return WalletTimeline.fromJson(response.data as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> getScore(String userId) async {
    final response = await _client.dio.get('/users/$userId/score');
    return response.data as Map<String, dynamic>;
  }
}
