import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { MentorshipBookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateOfferingDto } from './dto/create-offering.dto';
import { AddSlotsDto } from './dto/add-slots.dto';

/** How many upcoming free slots each offering card carries in the list response. */
const NEXT_SLOTS_PREVIEW = 3;

/**
 * How long a Checkout Session is allowed to hold a slot.
 *
 * A slot is only marked `booked` by a real Stripe event, so between "Checkout
 * opened" and "payment confirmed" the PENDING booking row is what reserves it
 * (the unique index on `slotId` is what enforces that). Without an expiry, a
 * mentee who opened Checkout and closed the tab would take the slot off the
 * market permanently. The Checkout Session is created with a matching
 * `expires_at`, so a hold older than this window provably cannot be paid and
 * is safe to release.
 *
 * Stripe's minimum `expires_at` is 30 minutes out; the extra 5 minutes here is
 * clock-skew grace, so we never release a hold Stripe would still honour.
 */
const CHECKOUT_EXPIRY_MINUTES = 31;
const HOLD_WINDOW_MS = (CHECKOUT_EXPIRY_MINUTES + 5) * 60 * 1000;

/**
 * One-to-one mentorship. `LiveMastermindSession` is the group counterpart —
 * this is the same commercial idea with a chosen mentor and a private
 * calendar.
 *
 * Money rule, held everywhere in this codebase: `bookSlot` only opens a Stripe
 * Checkout Session. It does not mark the slot booked and it does not confirm
 * the booking. `completeBooking`, driven by a real
 * `checkout.session.completed`, is the only place either happens.
 */
@Injectable()
export class MentorshipService {
  private readonly logger = new Logger(MentorshipService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  /**
   * The mentorship marketplace listing.
   *
   * Without `mentorId` this is a storefront: only `active` offerings that have
   * at least one future free slot, because an offering nobody can book is
   * noise on a browse screen. With `mentorId` both filters are lifted on
   * purpose — that call is "show me this mentor's catalogue" (their own
   * profile page, or the mentor reviewing what they published), where a
   * fully-booked or paused offering is exactly what the caller wants to see.
   */
  async listOfferings(search?: string, mentorId?: string, limit = 20, offset = 0) {
    const now = new Date();

    const where: Prisma.MentorshipOfferingWhereInput = {
      ...(mentorId
        ? { mentorId }
        : { active: true, slots: { some: { booked: false, startsAt: { gt: now } } } }),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { topics: { hasSome: [search] } },
              { mentor: { profile: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [offerings, total] = await this.prisma.$transaction([
      this.prisma.mentorshipOffering.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          mentor: {
            select: {
              id: true,
              profile: { select: { name: true, mentorHeadline: true } },
              score: { select: { financialHealthScore: true } },
            },
          },
          slots: {
            where: { booked: false, startsAt: { gt: now } },
            orderBy: { startsAt: 'asc' },
            take: NEXT_SLOTS_PREVIEW,
            select: { id: true, startsAt: true },
          },
        },
      }),
      this.prisma.mentorshipOffering.count({ where }),
    ]);

    return {
      offerings: offerings.map((offering) => ({
        id: offering.id,
        mentorId: offering.mentorId,
        mentorName: offering.mentor.profile?.name ?? 'Mentor',
        mentorHeadline: offering.mentor.profile?.mentorHeadline ?? null,
        // Missing score row counts as 0 — same rule AcademyService.listMentors
        // applies, so the two directories rank on the same number.
        kScore: offering.mentor.score?.financialHealthScore ?? 0,
        title: offering.title,
        description: offering.description,
        durationMinutes: offering.durationMinutes,
        price: offering.price,
        currency: offering.currency,
        topics: offering.topics,
        nextSlots: offering.slots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt })),
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Publishing an offering is restricted to the curated mentor group —
   * `UserProfile.isMentor`, which only an admin can grant (PATCH
   * /admin/users/:userId/mentor) and which a user can never set on themselves.
   * Without this check the mentors directory stays editorial while the paid
   * one-to-one product becomes opt-in, which is the same product with the
   * quality bar removed.
   */
  async createOffering(mentorId: string, dto: CreateOfferingDto) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: mentorId },
      select: { isMentor: true },
    });
    if (!profile?.isMentor) {
      throw new ForbiddenException('Apenas mentores aprovados podem publicar mentorias individuais');
    }

    const startsAt = this.parseFutureSlots(dto.slots);

    return this.prisma.mentorshipOffering.create({
      data: {
        mentorId,
        title: dto.title,
        description: dto.description,
        durationMinutes: dto.durationMinutes,
        price: new Prisma.Decimal(dto.price),
        currency: dto.currency,
        topics: dto.topics ?? [],
        slots: { create: startsAt.map((instant) => ({ startsAt: instant })) },
      },
      include: { slots: { orderBy: { startsAt: 'asc' } } },
    });
  }

  /** Owner-only. Re-publishing an instant that already exists is a no-op, not an error. */
  async addSlots(mentorId: string, offeringId: string, dto: AddSlotsDto) {
    const offering = await this.prisma.mentorshipOffering.findUnique({ where: { id: offeringId } });
    if (!offering) throw new NotFoundException('Mentoria não encontrada');
    if (offering.mentorId !== mentorId) {
      throw new ForbiddenException('Você só pode adicionar horários às suas próprias mentorias');
    }

    const startsAt = this.parseFutureSlots(dto.slots);

    // skipDuplicates leans on @@unique([offeringId, startsAt]): a mentor
    // re-submitting a calendar that overlaps what they already published gets
    // the new instants added and the old ones left exactly as they are —
    // including any that are already booked.
    await this.prisma.mentorshipSlot.createMany({
      data: startsAt.map((instant) => ({ offeringId, startsAt: instant })),
      skipDuplicates: true,
    });

    return this.prisma.mentorshipSlot.findMany({
      where: { offeringId },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Opens Stripe Checkout for one slot. Mirrors `AcademyService.initiatePurchase`.
   *
   * Nothing here confirms anything: the booking is written PENDING and the slot
   * is left free until `completeBooking` runs off a real Stripe event.
   */
  async bookSlot(menteeId: string, slotId: string) {
    const slot = await this.prisma.mentorshipSlot.findUnique({
      where: { id: slotId },
      include: { offering: true, booking: true },
    });
    if (!slot) throw new NotFoundException('Horário não encontrado');

    const { offering } = slot;
    if (offering.mentorId === menteeId) {
      throw new BadRequestException('Você não pode contratar a sua própria mentoria');
    }
    if (!offering.active) {
      throw new BadRequestException('Esta mentoria não está mais disponível');
    }
    if (slot.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Este horário já passou');
    }
    if (slot.booked) {
      throw new BadRequestException('Este horário já está reservado');
    }

    await this.releaseOrRejectExistingHold(slot.booking);

    const mentee = await this.prisma.user.findUniqueOrThrow({ where: { id: menteeId } });
    const stripeCustomerId = await this.ensureStripeCustomer(menteeId, mentee.email);
    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';

    const checkout = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      // Bounds how long the PENDING booking below can hold the slot — see
      // HOLD_WINDOW_MS.
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRY_MINUTES * 60,
      line_items: [
        {
          price_data: {
            currency: offering.currency.toLowerCase(),
            unit_amount: Math.round(Number(offering.price) * 100),
            product_data: { name: `Mentoria individual: ${offering.title}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/mentorship/booking-success`,
      cancel_url: `${appUrl}/mentorship/booking-cancel`,
      metadata: {
        kind: 'mentorship_booking',
        slotId,
        offeringId: offering.id,
        menteeId,
      },
    });

    try {
      await this.prisma.mentorshipBooking.create({
        data: {
          slotId,
          offeringId: offering.id,
          menteeId,
          status: MentorshipBookingStatus.PENDING,
          pricePaid: offering.price,
          currency: offering.currency,
          stripeCheckoutSessionId: checkout.id,
        },
      });
    } catch (err) {
      // The unique index on slotId is the real arbiter: two mentees opening
      // Checkout for the same slot at the same instant both pass the read
      // above, and exactly one of them lands this insert.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.stripe.checkout.sessions.expire(checkout.id).catch(() => undefined);
        throw new BadRequestException('Este horário acabou de ser reservado por outra pessoa');
      }
      throw err;
    }

    this.logger.log(
      `Checkout session ${checkout.id} opened for mentee ${menteeId} booking slot ${slotId} ` +
        `(offering ${offering.id}) at ${Number(offering.price)} ${offering.currency}`,
    );

    return { checkoutUrl: checkout.url };
  }

  /** Both sides of the caller's mentorship activity, kept separate on purpose. */
  async listBookings(userId: string) {
    const include = {
      offering: {
        select: {
          id: true,
          title: true,
          durationMinutes: true,
          mentorId: true,
          mentor: { select: { profile: { select: { name: true } } } },
        },
      },
      slot: { select: { id: true, startsAt: true } },
      mentee: { select: { id: true, profile: { select: { name: true } } } },
    } satisfies Prisma.MentorshipBookingInclude;

    const [asMentee, asMentor] = await this.prisma.$transaction([
      this.prisma.mentorshipBooking.findMany({
        where: { menteeId: userId },
        orderBy: { createdAt: 'desc' },
        include,
      }),
      this.prisma.mentorshipBooking.findMany({
        where: { offering: { mentorId: userId } },
        orderBy: { createdAt: 'desc' },
        include,
      }),
    ]);

    const shape = (booking: (typeof asMentee)[number]) => ({
      id: booking.id,
      status: booking.status,
      offeringId: booking.offeringId,
      offeringTitle: booking.offering.title,
      durationMinutes: booking.offering.durationMinutes,
      mentorId: booking.offering.mentorId,
      mentorName: booking.offering.mentor.profile?.name ?? 'Mentor',
      menteeId: booking.menteeId,
      menteeName: booking.mentee.profile?.name ?? 'Cliente',
      slotId: booking.slotId,
      startsAt: booking.slot.startsAt,
      pricePaid: booking.pricePaid,
      currency: booking.currency,
      meetingUrl: booking.meetingUrl,
      createdAt: booking.createdAt,
    });

    return { asMentee: asMentee.map(shape), asMentor: asMentor.map(shape) };
  }

  /**
   * Called by StripeWebhookService once `checkout.session.completed` confirms
   * real payment. Wire-up in that file:
   *
   *   if (kind === 'mentorship_booking') {
   *     await this.mentorshipService.completeBooking(session);
   *     return;
   *   }
   *
   * Idempotent, and the slot is claimed in the SAME transaction that confirms
   * the booking. The claim is a conditional `updateMany` on `booked: false`,
   * so two concurrent deliveries of the same event — or of the
   * completed/async_payment_succeeded pair — serialize on the row lock and the
   * second one matches zero rows instead of writing a second confirmation.
   */
  async completeBooking(session: Stripe.Checkout.Session): Promise<void> {
    const { slotId, offeringId, menteeId } = session.metadata ?? {};
    if (!slotId || !offeringId || !menteeId) {
      this.logger.warn(
        `checkout.session.completed for a mentorship booking is missing metadata (session ${session.id})`,
      );
      return;
    }

    const amountPaid = (session.amount_total ?? 0) / 100;

    const outcome = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.mentorshipBooking.findUnique({ where: { slotId } });
      if (!booking) return 'missing-booking' as const;
      if (booking.menteeId !== menteeId) return 'mentee-mismatch' as const;
      if (booking.status === MentorshipBookingStatus.CONFIRMED) return 'already-confirmed' as const;

      const claimed = await tx.mentorshipSlot.updateMany({
        where: { id: slotId, booked: false },
        data: { booked: true },
      });
      if (claimed.count === 0) return 'slot-already-taken' as const;

      await tx.mentorshipBooking.update({
        where: { id: booking.id },
        data: {
          status: MentorshipBookingStatus.CONFIRMED,
          pricePaid: new Prisma.Decimal(amountPaid),
          stripeCheckoutSessionId: session.id,
        },
      });
      return 'confirmed' as const;
    });

    switch (outcome) {
      case 'confirmed':
        this.logger.log(
          `Mentorship booking confirmed: mentee ${menteeId} holds slot ${slotId} on offering ${offeringId} ` +
            `(${amountPaid}, session ${session.id})`,
        );
        return;
      case 'already-confirmed':
        this.logger.debug(
          `Mentorship slot ${slotId} already confirmed — ignoring duplicate webhook (session ${session.id})`,
        );
        return;
      case 'slot-already-taken':
        this.logger.warn(
          `Mentorship slot ${slotId} was already marked booked while confirming session ${session.id} — ` +
            'booking left unconfirmed for manual review rather than double-selling the slot',
        );
        return;
      case 'mentee-mismatch':
        this.logger.error(
          `Mentorship booking on slot ${slotId} belongs to another mentee than the paying customer ` +
            `${menteeId} (session ${session.id}) — nothing confirmed`,
        );
        return;
      default:
        this.logger.error(
          `checkout.session.completed for mentorship slot ${slotId} with no booking row (session ${session.id})`,
        );
    }
  }

  /**
   * A slot carries at most one booking row (unique `slotId`), so an abandoned
   * Checkout would otherwise keep it off the market forever. A PENDING hold
   * older than HOLD_WINDOW_MS is provably unpayable — its Checkout Session has
   * expired — so it is released; a CANCELED one is released unconditionally.
   * Anything else is a live reservation and the caller is turned away.
   */
  private async releaseOrRejectExistingHold(
    booking: { id: string; status: MentorshipBookingStatus; createdAt: Date } | null,
  ): Promise<void> {
    if (!booking) return;

    if (booking.status === MentorshipBookingStatus.CONFIRMED) {
      throw new BadRequestException('Este horário já está reservado');
    }

    const isStalePending =
      booking.status === MentorshipBookingStatus.PENDING &&
      Date.now() - booking.createdAt.getTime() > HOLD_WINDOW_MS;

    if (booking.status !== MentorshipBookingStatus.CANCELED && !isStalePending) {
      throw new BadRequestException(
        'Este horário está reservado temporariamente por outra pessoa que está finalizando o pagamento',
      );
    }

    // Conditional delete: if the hold got confirmed between the read and here,
    // this matches nothing and the insert in bookSlot fails on the unique
    // index — which is the correct outcome, not a double sale.
    const released = await this.prisma.mentorshipBooking.deleteMany({
      where: { id: booking.id, status: { not: MentorshipBookingStatus.CONFIRMED } },
    });
    if (released.count > 0) {
      this.logger.log(`Released ${booking.status.toLowerCase()} hold ${booking.id} on an unpaid mentorship slot`);
    }
  }

  /** Parses ISO instants, rejects the past, and de-duplicates within one request. */
  private parseFutureSlots(slots: string[]): Date[] {
    const now = Date.now();
    const parsed = slots.map((raw) => {
      const instant = new Date(raw);
      if (Number.isNaN(instant.getTime())) {
        throw new BadRequestException(`Horário inválido: ${raw}`);
      }
      if (instant.getTime() <= now) {
        throw new BadRequestException(`Horário no passado: ${raw}`);
      }
      return instant;
    });

    const unique = new Map<number, Date>();
    for (const instant of parsed) unique.set(instant.getTime(), instant);
    return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
  }

  /** Same customer-per-user rule as AcademyService/MastermindService. */
  private async ensureStripeCustomer(userId: string, email: string): Promise<string> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;

    const customer = await this.stripe.customers.create({ email, metadata: { userId } });
    await this.prisma.subscription.upsert({
      where: { userId },
      update: { stripeCustomerId: customer.id },
      create: { userId, stripeCustomerId: customer.id },
    });
    return customer.id;
  }
}
