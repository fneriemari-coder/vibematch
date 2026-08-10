import '../../core/api/dio_client.dart';
import '../models/user_models.dart';

class AuthRepository {
  AuthRepository(this._client);

  final DioClient _client;

  Future<AppUser> login(String email, String password) async {
    final response = await _client.dio.post(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    await _persistSession(response.data as Map<String, dynamic>);
    return AppUser.fromJson(response.data['user'] as Map<String, dynamic>);
  }

  Future<AppUser> register({
    required String email,
    required String password,
    required String name,
    required String role,
    required String country,
  }) async {
    final response = await _client.dio.post(
      '/auth/register',
      data: {
        'email': email,
        'password': password,
        'name': name,
        'role': role,
        'country': country,
      },
    );
    await _persistSession(response.data as Map<String, dynamic>);
    return AppUser.fromJson(response.data['user'] as Map<String, dynamic>);
  }

  Future<AppUser> me() async {
    final response = await _client.dio.get('/auth/me');
    return AppUser.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> logout() async {
    try {
      await _client.dio.post('/auth/logout');
    } catch (_) {
      // Best-effort server-side revocation — the local session is cleared
      // either way, so a network failure here shouldn't block sign-out.
    }
    await DioClient.clearToken();
  }

  Future<void> forgotPassword(String email) {
    return _client.dio.post('/auth/forgot-password', data: {'email': email});
  }

  Future<void> resetPassword({
    required String token,
    required String newPassword,
  }) {
    return _client.dio.post(
      '/auth/reset-password',
      data: {'token': token, 'newPassword': newPassword},
    );
  }

  Future<void> resendVerificationEmail() {
    return _client.dio.post('/auth/resend-verification');
  }

  /// LGPD/GDPR data-portability export — the full response payload from
  /// GET /users/me/data-export, shown as-is (see DataPrivacyScreen).
  Future<Map<String, dynamic>> exportMyData() async {
    final response = await _client.dio.get('/users/me/data-export');
    return response.data as Map<String, dynamic>;
  }

  /// LGPD/GDPR "right to erasure" — anonymizes the account (see
  /// data-privacy.service.ts for exactly what is/isn't erased). Clears the
  /// local session on success since the account is no longer usable.
  Future<void> deleteMyAccount(String password) async {
    await _client.dio.delete('/users/me', data: {'password': password});
    await DioClient.clearToken();
  }

  Future<void> _persistSession(Map<String, dynamic> data) async {
    await DioClient.persistToken(data['accessToken'] as String);
    await DioClient.persistRefreshToken(data['refreshToken'] as String);
  }

  Future<void> updateFcmToken(String fcmToken) {
    return _client.dio.put('/users/fcm-token', data: {'fcmToken': fcmToken});
  }
}
