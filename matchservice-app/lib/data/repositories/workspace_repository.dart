import 'package:dio/dio.dart';

import '../../core/api/dio_client.dart';
import '../models/workspace_models.dart';

/// The Copiloto workspace: documents the user puts in, and the analyses the
/// backend writes about them.
///
/// Uploads go through our own API as multipart (field name `file`) rather than
/// straight to S3 like `MediaRepository` does — the server has to read the
/// bytes to classify and index the document, so a presigned direct upload
/// would only mean fetching it back again.
class WorkspaceRepository {
  WorkspaceRepository(this._client);

  final DioClient _client;

  /// POST /workspace/documents — multipart, field name `file`, 10MB ceiling.
  ///
  /// Takes raw bytes rather than a path or an `XFile` so the same call works
  /// on web (where there is no filesystem path) and on mobile, and so text
  /// pasted into the composer can be uploaded with nothing but `utf8.encode`.
  Future<WorkspaceDocument> uploadDocument({
    required List<int> bytes,
    required String filename,
    required String mimeType,
  }) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: filename,
        contentType: _parseMediaType(mimeType),
      ),
    });
    final response = await _client.dio.post(
      '/workspace/documents',
      data: form,
    );
    return WorkspaceDocument.fromJson(
      (response.data as Map).cast<String, dynamic>(),
    );
  }

  /// GET /workspace/documents — the signed-in user's documents, newest first.
  ///
  /// The endpoint may hand back a bare array or wrap it in an envelope
  /// depending on how the controller is written, so both shapes are accepted
  /// rather than betting the list on one of them.
  Future<List<WorkspaceDocument>> listDocuments() async {
    final response = await _client.dio.get('/workspace/documents');
    return _documentList(response.data);
  }

  /// GET /workspace/documents/:id — the document plus its `analyses[]`.
  Future<WorkspaceDocument> getDocument(String id) async {
    final response = await _client.dio.get('/workspace/documents/$id');
    return WorkspaceDocument.fromJson(
      (response.data as Map).cast<String, dynamic>(),
    );
  }

  /// POST /workspace/documents/:id/analyses — asks one question of one
  /// document. Takes seconds; the caller is expected to keep an honest
  /// progress view up while it is in flight.
  ///
  /// [question] is trimmed here because the API counts characters against the
  /// 10..600 bounds and a trailing newline from the composer should not be
  /// what pushes a submission over the limit.
  Future<WorkspaceAnalysis> analyse(String documentId, String question) async {
    final response = await _client.dio.post(
      '/workspace/documents/$documentId/analyses',
      data: {'question': question.trim()},
    );
    return WorkspaceAnalysis.fromJson(
      (response.data as Map).cast<String, dynamic>(),
    );
  }

  /// DELETE /workspace/documents/:id.
  Future<void> deleteDocument(String id) async {
    await _client.dio.delete('/workspace/documents/$id');
  }

  static List<WorkspaceDocument> _documentList(Object? data) {
    final raw = data is Map
        ? (data['documents'] ??
            data['items'] ??
            data['data'] ??
            data['results'])
        : data;
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => WorkspaceDocument.fromJson(e.cast<String, dynamic>()))
        .toList(growable: false);
  }

  /// `http_parser`'s `MediaType` is a transitive dependency of Dio rather than
  /// a direct one, so it is not imported here — `DioMediaType` is Dio's own
  /// re-export and parsing keeps this working for every type the endpoint
  /// accepts without hard-coding a switch.
  static DioMediaType? _parseMediaType(String mimeType) {
    try {
      return DioMediaType.parse(mimeType);
    } catch (_) {
      // A malformed type must not cost the upload — Dio falls back to
      // application/octet-stream and the server sniffs it.
      return null;
    }
  }
}
