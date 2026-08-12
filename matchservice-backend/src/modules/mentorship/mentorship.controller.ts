import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { MentorshipService } from './mentorship.service';
import { CreateOfferingDto } from './dto/create-offering.dto';
import { AddSlotsDto } from './dto/add-slots.dto';
import { ListOfferingsQueryDto } from './dto/list-offerings-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('mentorship')
@UseGuards(JwtAuthGuard)
export class MentorshipController {
  constructor(private readonly mentorshipService: MentorshipService) {}

  /** Marketplace listing — see MentorshipService.listOfferings for the filter rules. */
  @Get('offerings')
  listOfferings(@Query() query: ListOfferingsQueryDto) {
    return this.mentorshipService.listOfferings(
      query.search,
      query.mentorId,
      query.limit,
      query.offset,
    );
  }

  /** Mentors only (`UserProfile.isMentor`) — 403 for everyone else. */
  @Post('offerings')
  createOffering(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOfferingDto) {
    return this.mentorshipService.createOffering(user.id, dto);
  }

  /** Owner-only: extends an offering's calendar. */
  @Post('offerings/:offeringId/slots')
  addSlots(
    @CurrentUser() user: AuthenticatedUser,
    @Param('offeringId', ParseUUIDPipe) offeringId: string,
    @Body() dto: AddSlotsDto,
  ) {
    return this.mentorshipService.addSlots(user.id, offeringId, dto);
  }

  /**
   * Opens Stripe Checkout. The slot is NOT marked booked here — that happens
   * only on `checkout.session.completed`, in MentorshipService.completeBooking.
   */
  @Post('slots/:slotId/book')
  bookSlot(@CurrentUser() user: AuthenticatedUser, @Param('slotId', ParseUUIDPipe) slotId: string) {
    return this.mentorshipService.bookSlot(user.id, slotId);
  }

  /** The caller's bookings as a mentee, and the bookings on their own offerings. */
  @Get('bookings')
  listBookings(@CurrentUser() user: AuthenticatedUser) {
    return this.mentorshipService.listBookings(user.id);
  }
}
