import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from './document-extractor';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { UploadTooLargeFilter } from './upload-exception.filter';
import { WorkspaceService } from './workspace.service';

/** What `FileInterceptor` (memory storage) hands back. Declared locally so the
 * module does not depend on multer's global type augmentation. */
interface UploadedDocument {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED = new Set<string>(ALLOWED_MIME_TYPES);

/**
 * The mime allowlist is enforced here, before a single byte is buffered.
 * Throwing an HttpException from multer's `fileFilter` is passed through
 * untouched by Nest's `transformException`, so the client gets the 415 with
 * this message rather than a generic 500.
 */
const uploadOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (
    _req: unknown,
    file: { mimetype: string; originalname: string },
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (ALLOWED.has(file.mimetype)) return callback(null, true);
    callback(
      new UnsupportedMediaTypeException(
        `Tipo de arquivo não aceito: ${file.mimetype}. O workspace lê ${[...ALLOWED].join(', ')} — ` +
          'se o seu documento estiver em outro formato, exporte para PDF ou CSV antes de subir.',
      ),
      false,
    );
  },
};

@Controller('workspace')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  /**
   * Drops a file into the workspace. Only its extracted text is stored; the
   * original bytes are archived to S3 only when S3 is configured.
   *
   * Throttled separately from the app-wide limit: this is the one route in the
   * module that buffers up to 10 MB and runs a PDF parser per call.
   */
  @Post('documents')
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  uploadDocument(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: UploadedDocument) {
    if (!file) {
      throw new BadRequestException(
        'Nenhum arquivo recebido. Envie o documento no campo “file” de um formulário multipart/form-data.',
      );
    }
    return this.workspaceService.createDocument(user.id, file);
  }

  /** Every document the caller has uploaded, newest first, with its analysis count. */
  @Get('documents')
  listDocuments(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaceService.listDocuments(user.id);
  }

  /** Owner-only; 403 for anyone else. See WorkspaceService.findDocument. */
  @Get('documents/:id')
  findDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaceService.findDocument(user.id, id);
  }

  /**
   * Asks one question of one document and returns the finished analysis.
   * Owner-only — a document is a contract or a P&L, and an id is guessable.
   */
  @Post('documents/:id/analyses')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  createAnalysis(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAnalysisDto,
  ) {
    return this.workspaceService.createAnalysis(user.id, id, dto);
  }

  /** Owner-only. Analyses cascade off the document. */
  @Delete('documents/:id')
  deleteDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaceService.deleteDocument(user.id, id);
  }
}
