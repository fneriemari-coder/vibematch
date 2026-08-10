import { IsIn } from 'class-validator';

// Kept intentionally narrow — an open-ended contentType would let a client
// presign a URL for arbitrary file types (e.g. executables) even though the
// actual bytes never pass through our API to be inspected.
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'] as const;
const ALLOWED_PURPOSES = ['discovery_post', 'profile_photo', 'chat_attachment'] as const;

export class PresignedUploadDto {
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];

  @IsIn(ALLOWED_PURPOSES)
  purpose: (typeof ALLOWED_PURPOSES)[number];
}
