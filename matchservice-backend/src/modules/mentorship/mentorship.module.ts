import { Module } from '@nestjs/common';
import { MentorshipService } from './mentorship.service';
import { MentorshipController } from './mentorship.controller';

/**
 * `MentorshipService` is exported so `StripeWebhookService` can call
 * `completeBooking` on `checkout.session.completed` — the same wiring
 * AcademyModule and MastermindModule use for their own paid products.
 */
@Module({
  providers: [MentorshipService],
  controllers: [MentorshipController],
  exports: [MentorshipService],
})
export class MentorshipModule {}
