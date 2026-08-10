import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const start = process.hrtime.bigint();

    const record = () => {
      // req.route.path is the Express template ("/academy/courses/:courseId");
      // falls back to the raw path only for routes Express hasn't matched yet
      // (e.g. a 404), which is low-cardinality enough on its own.
      const route = req.route?.path ?? req.path ?? 'unknown';
      const labels = { method: req.method, route, status_code: String(res.statusCode) };
      this.metrics.httpRequestsTotal.inc(labels);
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.httpRequestDurationSeconds.observe(labels, seconds);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
