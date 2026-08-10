import '../../core/api/dio_client.dart';
import '../models/admin_metrics.dart';
import '../models/admin_user_models.dart';

class AdminRepository {
  AdminRepository(this._client);

  final DioClient _client;

  /// 403s here if the caller isn't Role.ADMIN — see RolesGuard server-side.
  Future<DashboardMetrics> getDashboardMetrics(MetricsPeriod period) async {
    final response = await _client.dio.get(
      '/admin/dashboard-metrics',
      queryParameters: {'period': period.apiValue},
    );
    return DashboardMetrics.fromJson(response.data as Map<String, dynamic>);
  }

  Future<AdminUserListResult> listUsers({
    String? search,
    AccountStatus? accountStatus,
    int limit = 20,
    int offset = 0,
  }) async {
    final response = await _client.dio.get(
      '/admin/users',
      queryParameters: {
        if (search != null && search.isNotEmpty) 'search': search,
        if (accountStatus != null) 'accountStatus': accountStatus.apiValue,
        'limit': limit,
        'offset': offset,
      },
    );
    return AdminUserListResult.fromJson(response.data as Map<String, dynamic>);
  }

  Future<AdminUserSummary> updateAccountStatus(
    String userId,
    AccountStatus status,
  ) async {
    final response = await _client.dio.patch(
      '/admin/users/$userId/account-status',
      data: {'accountStatus': status.apiValue},
    );
    return AdminUserSummary.fromJson(response.data as Map<String, dynamic>);
  }

  Future<AdminUserSummary> setIdentityVerified(
    String userId,
    bool verified,
  ) async {
    final response = await _client.dio.patch(
      '/admin/users/$userId/identity-verified',
      data: {'identityVerified': verified},
    );
    return AdminUserSummary.fromJson(response.data as Map<String, dynamic>);
  }
}
