import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3StorageService } from '../../common/storage/s3-storage.service';
import { PresignedUploadDto } from './dto/presigned-upload.dto';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

@Injectable()
export class MediaService {
  constructor(private readonly storage: S3StorageService) {}

  /**
   * Namespaces every key under the requesting user's own id/purpose — the
   * client can never presign a URL that writes into another user's or
   * another purpose's prefix.
   */
  async createPresignedUpload(userId: string, dto: PresignedUploadDto) {
    const extension = EXTENSION_BY_CONTENT_TYPE[dto.contentType];
    const key = `uploads/${dto.purpose}/${userId}/${randomUUID()}.${extension}`;
    const { uploadUrl, publicUrl, expiresInSeconds } = await this.storage.getPresignedUploadUrl(key, dto.contentType);
    return { uploadUrl, publicUrl, expiresInSeconds, method: 'PUT' as const, headers: { 'Content-Type': dto.contentType } };
  }
}
