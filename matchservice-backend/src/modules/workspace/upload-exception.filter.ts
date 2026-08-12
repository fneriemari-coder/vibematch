import { ArgumentsHost, Catch, ExceptionFilter, Logger, PayloadTooLargeException } from '@nestjs/common';
import { MAX_UPLOAD_BYTES } from './document-extractor';

/**
 * Nest's `FileInterceptor` already maps multer's LIMIT_FILE_SIZE to a 413 —
 * with multer's own English string, "File too large", which is the one message
 * in this whole flow a Brazilian user would read in another language.
 *
 * This narrows to exactly that exception (nothing else is intercepted, so it
 * cannot mask a real fault) and rewrites the body in the product's language,
 * stating the actual cap instead of an adjective.
 */
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter implements ExceptionFilter {
  private readonly logger = new Logger(UploadTooLargeFilter.name);

  catch(exception: PayloadTooLargeException, host: ArgumentsHost) {
    const megabytes = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    this.logger.warn(`Upload rejected — over the ${megabytes} MB workspace limit`);

    host
      .switchToHttp()
      .getResponse()
      .status(413)
      .json({
        statusCode: 413,
        error: 'Payload Too Large',
        message:
          `Arquivo acima do limite de ${megabytes} MB do workspace. ` +
          'Envie um arquivo menor, ou separe o documento em partes e suba uma de cada vez.',
      });
  }
}
