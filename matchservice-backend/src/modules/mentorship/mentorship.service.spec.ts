import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Currency, MentorshipBookingStatus } from '@prisma/client';
import { MentorshipService } from './mentorship.service';

function buildDeps() {
  const prisma: any = {
    mentorshipOffering: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    mentorshipSlot: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
    mentorshipBooking: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userProfile: { findUnique: jest.fn() },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'mentee-1', email: 'm@example.com' }) },
    subscription: {
      findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_existing' }),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  };
  const config = { get: jest.fn(() => undefined) };
  const service = new MentorshipService(prisma, config as any);
  // Stripe is never reachable from the test environment; the service's only
  // use of it in these paths is opening/expiring a Checkout Session.
  (service as any).stripe = {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }),
        expire: jest.fn().mockResolvedValue({}),
      },
    },
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
  };
  return { service, prisma };
}

const FUTURE = () => new Date(Date.now() + 48 * 60 * 60 * 1000);

function offering(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offering-1',
    mentorId: 'mentor-1',
    title: 'Mentoria de caixa',
    price: 450,
    currency: Currency.BRL,
    active: true,
    ...overrides,
  };
}

describe('MentorshipService', () => {
  describe('createOffering', () => {
    it('rejects a user whose profile is not a curated mentor', async () => {
      const { service, prisma } = buildDeps();
      prisma.userProfile.findUnique.mockResolvedValue({ isMentor: false });

      await expect(
        service.createOffering('user-1', {
          title: 'Mentoria',
          description: 'Uma descrição suficientemente longa para o DTO.',
          durationMinutes: 60,
          price: 300,
          currency: Currency.BRL,
          slots: [FUTURE().toISOString()],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.mentorshipOffering.create).not.toHaveBeenCalled();
    });

    it('rejects a slot in the past', async () => {
      const { service, prisma } = buildDeps();
      prisma.userProfile.findUnique.mockResolvedValue({ isMentor: true });

      await expect(
        service.createOffering('mentor-1', {
          title: 'Mentoria',
          description: 'Uma descrição suficientemente longa para o DTO.',
          durationMinutes: 60,
          price: 300,
          currency: Currency.BRL,
          slots: [new Date(Date.now() - 60_000).toISOString()],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('de-duplicates repeated instants in one request', async () => {
      const { service, prisma } = buildDeps();
      prisma.userProfile.findUnique.mockResolvedValue({ isMentor: true });
      prisma.mentorshipOffering.create.mockResolvedValue({ id: 'offering-1' });
      const instant = FUTURE().toISOString();

      await service.createOffering('mentor-1', {
        title: 'Mentoria',
        description: 'Uma descrição suficientemente longa para o DTO.',
        durationMinutes: 60,
        price: 300,
        currency: Currency.BRL,
        slots: [instant, instant],
      });

      expect(prisma.mentorshipOffering.create.mock.calls[0][0].data.slots.create).toHaveLength(1);
    });
  });

  describe('addSlots', () => {
    it('rejects a caller who does not own the offering', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipOffering.findUnique.mockResolvedValue(offering());

      await expect(
        service.addSlots('someone-else', 'offering-1', { slots: [FUTURE().toISOString()] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s on an unknown offering', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipOffering.findUnique.mockResolvedValue(null);

      await expect(
        service.addSlots('mentor-1', 'nope', { slots: [FUTURE().toISOString()] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('bookSlot', () => {
    it('rejects booking your own offering', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipSlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        startsAt: FUTURE(),
        booked: false,
        offering: offering(),
        booking: null,
      });

      await expect(service.bookSlot('mentor-1', 'slot-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-booked slot', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipSlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        startsAt: FUTURE(),
        booked: true,
        offering: offering(),
        booking: null,
      });

      await expect(service.bookSlot('mentee-1', 'slot-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a slot in the past', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipSlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        startsAt: new Date(Date.now() - 60_000),
        booked: false,
        offering: offering(),
        booking: null,
      });

      await expect(service.bookSlot('mentee-1', 'slot-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a slot another mentee is actively paying for', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipSlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        startsAt: FUTURE(),
        booked: false,
        offering: offering(),
        booking: { id: 'hold-1', status: MentorshipBookingStatus.PENDING, createdAt: new Date() },
      });

      await expect(service.bookSlot('mentee-1', 'slot-1')).rejects.toThrow(BadRequestException);
      expect(prisma.mentorshipBooking.create).not.toHaveBeenCalled();
    });

    it('releases a hold whose Checkout Session can no longer be paid', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipSlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        startsAt: FUTURE(),
        booked: false,
        offering: offering(),
        booking: {
          id: 'hold-1',
          status: MentorshipBookingStatus.PENDING,
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      await service.bookSlot('mentee-1', 'slot-1');

      expect(prisma.mentorshipBooking.deleteMany).toHaveBeenCalled();
      expect(prisma.mentorshipBooking.create).toHaveBeenCalled();
    });

    it('creates the booking PENDING and never marks the slot booked', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipSlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        startsAt: FUTURE(),
        booked: false,
        offering: offering(),
        booking: null,
      });

      const result = await service.bookSlot('mentee-1', 'slot-1');

      expect(result.checkoutUrl).toBe('https://checkout.stripe.test/cs_test_1');
      expect(prisma.mentorshipBooking.create.mock.calls[0][0].data).toMatchObject({
        slotId: 'slot-1',
        offeringId: 'offering-1',
        menteeId: 'mentee-1',
        status: MentorshipBookingStatus.PENDING,
      });
      expect(prisma.mentorshipSlot.updateMany).not.toHaveBeenCalled();
    });

    it('carries the metadata the Stripe webhook routes on', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipSlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        startsAt: FUTURE(),
        booked: false,
        offering: offering(),
        booking: null,
      });

      await service.bookSlot('mentee-1', 'slot-1');

      const params = (service as any).stripe.checkout.sessions.create.mock.calls[0][0];
      expect(params.metadata).toEqual({
        kind: 'mentorship_booking',
        slotId: 'slot-1',
        offeringId: 'offering-1',
        menteeId: 'mentee-1',
      });
      expect(params.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('completeBooking', () => {
    const session = (overrides: Record<string, unknown> = {}) =>
      ({
        id: 'cs_test_1',
        amount_total: 45000,
        metadata: { kind: 'mentorship_booking', slotId: 'slot-1', offeringId: 'offering-1', menteeId: 'mentee-1' },
        ...overrides,
      }) as any;

    it('confirms the booking and claims the slot in the same transaction', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        menteeId: 'mentee-1',
        status: MentorshipBookingStatus.PENDING,
      });
      prisma.mentorshipSlot.updateMany.mockResolvedValue({ count: 1 });

      await service.completeBooking(session());

      expect(prisma.mentorshipSlot.updateMany).toHaveBeenCalledWith({
        where: { id: 'slot-1', booked: false },
        data: { booked: true },
      });
      expect(prisma.mentorshipBooking.update.mock.calls[0][0].data).toMatchObject({
        status: MentorshipBookingStatus.CONFIRMED,
        stripeCheckoutSessionId: 'cs_test_1',
      });
      expect(prisma.mentorshipBooking.update.mock.calls[0][0].data.pricePaid.toString()).toBe('450');
    });

    it('is idempotent against a replayed webhook', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        menteeId: 'mentee-1',
        status: MentorshipBookingStatus.CONFIRMED,
      });

      await service.completeBooking(session());

      expect(prisma.mentorshipSlot.updateMany).not.toHaveBeenCalled();
      expect(prisma.mentorshipBooking.update).not.toHaveBeenCalled();
    });

    it('does not confirm when a concurrent delivery already claimed the slot', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        menteeId: 'mentee-1',
        status: MentorshipBookingStatus.PENDING,
      });
      prisma.mentorshipSlot.updateMany.mockResolvedValue({ count: 0 });

      await service.completeBooking(session());

      expect(prisma.mentorshipBooking.update).not.toHaveBeenCalled();
    });

    it('ignores an event with no booking metadata', async () => {
      const { service, prisma } = buildDeps();

      await service.completeBooking(session({ metadata: {} }));

      expect(prisma.mentorshipBooking.findUnique).not.toHaveBeenCalled();
    });

    it('refuses to confirm when the paying customer is not the booking holder', async () => {
      const { service, prisma } = buildDeps();
      prisma.mentorshipBooking.findUnique.mockResolvedValue({
        id: 'booking-1',
        menteeId: 'someone-else',
        status: MentorshipBookingStatus.PENDING,
      });

      await service.completeBooking(session());

      expect(prisma.mentorshipSlot.updateMany).not.toHaveBeenCalled();
      expect(prisma.mentorshipBooking.update).not.toHaveBeenCalled();
    });
  });
});
