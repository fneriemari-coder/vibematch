import { ConsoleLogger, LoggerService, LogLevel } from '@nestjs/common';

/**
 * Structured logging for anything that consumes stdout as a log stream
 * (Docker/ECS/Cloud Run/etc.) — one JSON object per line instead of Nest's
 * colorized human-readable format, which is unparseable by log aggregators.
 *
 * Every existing `new Logger(Foo.name)` call site in the app is unaffected
 * code-wise: Nest's `Logger` class delegates to whatever LoggerService is
 * registered via `app.useLogger()` (see main.ts), so switching the format
 * app-wide only required this one file plus the one line wiring it in.
 *
 * NODE_ENV=production -> JSON lines. Anything else -> Nest's normal
 * colorized console output, which is far more readable while developing.
 */
export class AppLogger extends ConsoleLogger implements LoggerService {
  private readonly structured = process.env.NODE_ENV === 'production';

  log(message: unknown, ...rest: unknown[]) {
    this.structured ? this.writeJson('log', message, rest) : super.log(message as string, ...(rest as any[]));
  }

  error(message: unknown, ...rest: unknown[]) {
    this.structured ? this.writeJson('error', message, rest) : super.error(message as string, ...(rest as any[]));
  }

  warn(message: unknown, ...rest: unknown[]) {
    this.structured ? this.writeJson('warn', message, rest) : super.warn(message as string, ...(rest as any[]));
  }

  debug(message: unknown, ...rest: unknown[]) {
    this.structured ? this.writeJson('debug', message, rest) : super.debug(message as string, ...(rest as any[]));
  }

  verbose(message: unknown, ...rest: unknown[]) {
    this.structured ? this.writeJson('verbose', message, rest) : super.verbose(message as string, ...(rest as any[]));
  }

  private writeJson(level: LogLevel, message: unknown, rest: unknown[]) {
    // Nest calls log(message, context) or error(message, trace, context) —
    // the last string-typed arg is conventionally the context/logger name.
    const context = typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : undefined;
    const trace = level === 'error' && typeof rest[0] === 'string' && rest[0] !== context ? (rest[0] as string) : undefined;

    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        context,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        ...(trace ? { trace } : {}),
      }) + '\n',
    );
  }
}
