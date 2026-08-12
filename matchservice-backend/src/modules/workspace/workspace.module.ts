import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

/**
 * The AI analysis workspace: upload a document, ask what you want to know,
 * get an analysis of that document plus the providers on this marketplace who
 * could execute what it recommends.
 *
 * `StorageModule` is imported for the optional S3 archive of the original
 * file. Nothing here requires it to be configured — when it is not, the
 * extracted text is kept and `storageUrl` stays null.
 */
@Module({
  imports: [StorageModule],
  providers: [WorkspaceService],
  controllers: [WorkspaceController],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
