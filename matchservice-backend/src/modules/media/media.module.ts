import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaProxyController } from './media-proxy.controller';
import { MediaProxyService } from './media-proxy.service';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [MediaController, MediaProxyController],
  providers: [MediaService, MediaProxyService],
})
export class MediaModule {}
