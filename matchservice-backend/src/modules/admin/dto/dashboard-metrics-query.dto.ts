import { IsIn, IsOptional } from 'class-validator';

export type MetricsPeriod = '7d' | '30d' | 'quarter';

export class DashboardMetricsQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', 'quarter'])
  period?: MetricsPeriod = '30d';
}
