import { Module } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { CommunitiesController } from './communities.controller';

@Module({
  providers: [CommunitiesService],
  controllers: [CommunitiesController],
  // FintechModule pulls this in so StripeWebhookService can flip a PENDING
  // seat to ACTIVE on checkout.session.completed.
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
