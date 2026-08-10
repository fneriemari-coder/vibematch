import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Reports unhandled/5xx errors to Sentry, then falls back to Nest's default
 * HTTP response formatting (BaseExceptionFilter) — this filter never
 * changes what the client receives, only what gets reported.
 *
 * Expected client errors (4xx HttpExceptions — validation failures, 401s,
 * 404s, the deliberate 402 paywall, etc.) are NOT sent to Sentry; only
 * genuine 5xx/unknown failures are, so Sentry stays signal, not noise.
 *
 * A no-op if SENTRY_DSN isn't configured (see main.ts) — Sentry.captureException
 * is safe to call even when Sentry.init() was never invoked, it just drops the event.
 */
@Catch()
export class SentryExceptionsFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionsFilter.name);

  // Registered in main.ts via `app.useGlobalFilters(new SentryExceptionsFilter(httpAdapter))`
  // rather than as an APP_FILTER provider — BaseExceptionFilter needs the
  // concrete http adapter, which isn't reliably resolvable through plain DI
  // at provider-construction time (this is Nest's own documented pattern
  // for a catch-all filter that extends BaseExceptionFilter).
  catch(exception: unknown, host: ArgumentsHost) {
    const isClientError = exception instanceof HttpException && exception.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isClientError) {
      Sentry.captureException(exception);
      this.logger.error(exception instanceof Error ? exception.message : String(exception), (exception as Error)?.stack);
    }

    super.catch(exception, host);
  }
}
