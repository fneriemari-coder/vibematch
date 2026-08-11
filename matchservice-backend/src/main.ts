import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import * as express from 'express';
import { AppModule } from './app.module';
import { AppLogger } from './common/logging/app-logger.service';
import { SentryExceptionsFilter } from './common/filters/sentry-exceptions.filter';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development', tracesSampleRate: 0.1 });
} else {
  // eslint-disable-next-line no-console
  console.warn('SENTRY_DSN not set — error tracking disabled (errors still logged to stdout)');
}

async function bootstrap() {
  // bodyParser disabled globally so the Stripe webhook route can register its
  // own raw-body middleware BEFORE the JSON parser — Stripe's signature check
  // needs the exact unparsed request bytes (see stripe-webhook.controller.ts).
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: new AppLogger() });

  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const config = app.get(ConfigService);

  app.enableCors({
    origin: (config.get<string>('CORS_ORIGIN') ?? '').split(',').filter(Boolean),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionsFilter(httpAdapter));

  const port = config.get<number>('PORT') ?? 3000;
  // Bind explicitly to 0.0.0.0, not Node's default (`::`). Container
  // platforms (Railway, Render, Fly, Cloud Run) route to the container over
  // IPv4, and a server listening only on the IPv6 wildcard answers nothing —
  // which surfaces as a healthy-looking container whose every request times
  // out at the edge proxy ("Application failed to respond").
  await app.listen(port, '0.0.0.0');
  Logger.log(`MatchService backend listening on 0.0.0.0:${port}`, 'Bootstrap');
}

bootstrap();
