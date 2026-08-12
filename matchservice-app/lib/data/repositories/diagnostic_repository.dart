import '../../core/api/dio_client.dart';
import '../models/diagnostic_models.dart';

/// The business diagnostic: the manager describes their situation, the backend
/// scores the four pillars and writes the recommendations and the hiring brief.
class DiagnosticRepository {
  DiagnosticRepository(this._client);

  final DioClient _client;

  /// POST /diagnostics — generation takes several seconds, so the caller is
  /// expected to keep an honest progress view up while this is in flight.
  ///
  /// [situation] is trimmed here because the API counts characters against the
  /// 40..4000 bounds and a trailing newline from the composer should not be
  /// what pushes a submission over the limit.
  Future<Diagnostic> create({required String situation}) async {
    final response = await _client.dio.post(
      '/diagnostics',
      data: {'situation': situation.trim()},
    );
    return Diagnostic.fromJson(response.data as Map<String, dynamic>);
  }

  /// GET /diagnostics — the signed-in user's past diagnostics, newest first.
  ///
  /// The endpoint may hand back a bare array or wrap it in an envelope
  /// depending on how the controller is written, so both shapes are accepted
  /// rather than betting the history screen on one of them.
  Future<List<Diagnostic>> listMine() async {
    final response = await _client.dio.get('/diagnostics');
    return _diagnosticList(response.data);
  }

  Future<Diagnostic> getById(String id) async {
    final response = await _client.dio.get('/diagnostics/$id');
    return Diagnostic.fromJson(response.data as Map<String, dynamic>);
  }

  static List<Diagnostic> _diagnosticList(Object? data) {
    final raw = data is Map
        ? (data['diagnostics'] ??
            data['items'] ??
            data['data'] ??
            data['results'])
        : data;
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => Diagnostic.fromJson(e.cast<String, dynamic>()))
        .toList(growable: false);
  }
}
