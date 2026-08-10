import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Liveness/readiness probe — real DB round-trip, not a hardcoded 200. */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'error', db: 'down', message: (err as Error).message });
    }
    return { status: 'ok', db: 'up', timestamp: new Date().toISOString() };
  }
}
