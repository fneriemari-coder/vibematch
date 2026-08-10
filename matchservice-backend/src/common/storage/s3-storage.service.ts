import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Shared S3 (or DigitalOcean Spaces, same API) upload helper — used by
 * ai-factory.service.ts (course material PDFs) and certificate.service.ts
 * (issued certificate PDFs). Requires real AWS_* credentials; when they
 * aren't configured this throws loudly rather than fabricating a fake URL —
 * a PDF nobody can actually download is worse than an explicit 503.
 */
@Injectable()
export class S3StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket?: string;
  private readonly region?: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('AWS_S3_BUCKET');
    this.region = this.config.get<string>('AWS_REGION');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (this.bucket && this.region && accessKeyId && secretAccessKey) {
      this.client = new S3Client({ region: this.region, credentials: { accessKeyId, secretAccessKey } });
    } else {
      this.client = null;
      this.logger.warn('AWS S3 credentials not fully configured — PDF uploads will fail until they are set');
    }
  }

  async uploadBuffer(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'File storage is not configured (AWS_S3_BUCKET/AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)',
      );
    }

    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );

    const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    this.logger.log(`Uploaded ${key} (${body.length} bytes) to S3`);
    return url;
  }

  /**
   * Presigned direct-to-S3 PUT — the mobile app uploads bytes straight to
   * `uploadUrl` (no request body ever transits our API), then stores
   * `publicUrl` on whatever record the media belongs to (DiscoveryPost,
   * UserProfile, ChatMessage). Throws the same explicit 503 as
   * `uploadBuffer` when AWS_* isn't configured — no fabricated URL.
   */
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; publicUrl: string; expiresInSeconds: number }> {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'File storage is not configured (AWS_S3_BUCKET/AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)',
      );
    }

    const expiresInSeconds = 300; // 5 minutes — long enough for a mobile upload, short enough to limit URL reuse
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
    const publicUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

    return { uploadUrl, publicUrl, expiresInSeconds };
  }
}
