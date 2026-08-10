import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape target. Left unauthenticated like any standard
 * Prometheus exporter — protect it at the network layer (internal-only
 * ingress/security group), not with a JWT that a scraper would need to
 * refresh.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
