import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/api/dio_client.dart';

enum MediaPurpose { discoveryPost, profilePhoto, chatAttachment }

extension on MediaPurpose {
  String get apiValue => switch (this) {
        MediaPurpose.discoveryPost => 'discovery_post',
        MediaPurpose.profilePhoto => 'profile_photo',
        MediaPurpose.chatAttachment => 'chat_attachment',
      };
}

/// Presigns a direct-to-S3 upload (POST /media/presigned-upload, JWT-authed)
/// and PUTs the picked file straight to S3 — the bytes never transit our
/// own API. See media.controller.ts / media.service.ts on the backend.
class MediaRepository {
  MediaRepository(this._client);

  final DioClient _client;

  /// Returns the final public URL to store as mediaUrl on whatever record
  /// this upload belongs to (DiscoveryPost, UserProfile, ChatMessage).
  Future<String> uploadPickedFile(XFile file, MediaPurpose purpose) async {
    final contentType = file.mimeType ?? _guessContentType(file.name);
    final presign = await _client.dio.post('/media/presigned-upload', data: {
      'contentType': contentType,
      'purpose': purpose.apiValue,
    });

    final uploadUrl = presign.data['uploadUrl'] as String;
    final publicUrl = presign.data['publicUrl'] as String;

    final bytes = await file.readAsBytes();
    // A bare Dio — the presigned URL's signature already grants the exact
    // permission needed; sending our own bearer token to S3 alongside it
    // would be meaningless (and some S3-compatible providers reject
    // unexpected headers on a presigned request).
    await Dio().put(
      uploadUrl,
      data: bytes,
      options: Options(headers: {'Content-Type': contentType}),
    );

    return publicUrl;
  }

  String _guessContentType(String fileName) {
    final lower = fileName.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    return 'image/jpeg';
  }
}
