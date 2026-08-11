import { IsOptional, IsUUID } from 'class-validator';

/**
 * Target of POST /admin/simulation/demo-journey. Omitting `userId` runs the
 * journey against the calling admin, which is the common case: the owner
 * wants the finished deal to show up in their own app.
 */
export class RunDemoJourneyDto {
  @IsOptional()
  @IsUUID()
  userId?: string;
}
