import 'package:dio/dio.dart';

/// Pulls the server's own message out of a failed request so a screen can say
/// "Você precisa de K-Score 720 para entrar" instead of a generic network
/// apology. Nest's exception filter returns `message` as either a single string
/// or a list of validation strings, so both shapes are handled.
String describeApiError(Object error, {required String fallback}) {
  if (error is! DioException) return fallback;
  final data = error.response?.data;
  if (data is Map) {
    final message = data['message'];
    if (message is String && message.trim().isNotEmpty) return message.trim();
    if (message is List && message.isNotEmpty) {
      return message.map((e) => e.toString()).join('\n');
    }
  }
  return fallback;
}
