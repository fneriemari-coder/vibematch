import '../../core/api/dio_client.dart';
import '../models/admin_metrics.dart';

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
}
