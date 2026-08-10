import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MediaService } from './media.service';
import { PresignedUploadDto } from './dto/presigned-upload.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Returns a short-lived presigned S3 PUT URL — the mobile app uploads the
   * photo/video bytes directly to `uploadUrl` (never through our API), then
   * uses `publicUrl` as the mediaUrl on a DiscoveryPost / UserProfile /
   * ChatMessage. Throttled to blunt someone farming presigned URLs.
   */
  @Post('presigned-upload')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createPresignedUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: PresignedUploadDto) {
    return this.mediaService.createPresignedUpload(user.id, dto);
  }
}
