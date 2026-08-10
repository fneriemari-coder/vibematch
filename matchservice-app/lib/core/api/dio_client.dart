import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Single Dio instance for the whole app — base URL + JWT auth interceptor
/// + silent refresh-token retry on 401. Repositories take this in their
/// constructor rather than each building their own Dio, so the token/base
/// URL only ever live in one place.
class DioClient {
  DioClient({String? baseUrl})
    : dio = Dio(
        BaseOptions(
          baseUrl:
              baseUrl ??
              const String.fromEnvironment(
                'API_BASE_URL',
                defaultValue: 'http://localhost:3000',
              ),
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 15),
        ),
      ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString(_tokenKey);
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          // Access tokens are short-lived (15m — see auth.module.ts) by
          // design now that refresh tokens exist. Any other 401, or one on
          // /auth/* itself, means the session is actually dead — surface it
          // so AuthCubit logs the user out instead of retrying forever.
          final isAuthRoute = error.requestOptions.path.startsWith('/auth/');
          final alreadyRetried =
              error.requestOptions.extra['retriedAfterRefresh'] == true;
          if (error.response?.statusCode != 401 ||
              isAuthRoute ||
              alreadyRetried) {
            handler.next(error);
            return;
          }

          final newAccessToken = await _refreshAccessToken();
          if (newAccessToken == null) {
            handler.next(error);
            return;
          }

          final retryOptions = error.requestOptions
            ..headers['Authorization'] = 'Bearer $newAccessToken'
            ..extra['retriedAfterRefresh'] = true;
          try {
            handler.resolve(await dio.fetch(retryOptions));
          } on DioException catch (retryError) {
            handler.next(retryError);
          }
        },
      ),
    );
  }

  final Dio dio;
  static const _tokenKey = 'ms_access_token';
  static const _refreshTokenKey = 'ms_refresh_token';

  // Coalesces concurrent 401s (e.g. several requests firing at once) into a
  // single /auth/refresh call instead of racing multiple rotations, which
  // would invalidate each other's refresh token (see auth-token.service.ts —
  // refresh tokens are single-use/rotating).
  Future<String?>? _refreshInFlight;

  Future<String?> _refreshAccessToken() {
    return _refreshInFlight ??= _doRefresh().whenComplete(
      () => _refreshInFlight = null,
    );
  }

  Future<String?> _doRefresh() async {
    final prefs = await SharedPreferences.getInstance();
    final refreshToken = prefs.getString(_refreshTokenKey);
    if (refreshToken == null) return null;

    try {
      // A bare Dio instance — going through `dio` here would recurse into
      // this same onError handler on failure.
      final plainDio = Dio(BaseOptions(baseUrl: dio.options.baseUrl));
      final response = await plainDio.post(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final newAccess = response.data['accessToken'] as String;
      final newRefresh = response.data['refreshToken'] as String;
      await persistToken(newAccess);
      await persistRefreshToken(newRefresh);
      return newAccess;
    } catch (_) {
      // Refresh token itself is invalid/expired/revoked — clear everything
      // so the app falls back to the login screen instead of looping.
      await clearToken();
      return null;
    }
  }

  static Future<void> persistToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
  }

  static Future<void> persistRefreshToken(String refreshToken) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_refreshTokenKey, refreshToken);
  }

  static Future<void> clearToken() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_refreshTokenKey);
  }

  static Future<String?> readToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey);
  }
}
