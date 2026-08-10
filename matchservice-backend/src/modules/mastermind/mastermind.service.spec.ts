import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { MastermindService } from './mastermind.service';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

function buildDeps() {
  const prisma: any = {
    liveMastermindSession: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    mastermindBooking: { findUnique: jest.fn(), create: jest.fn() },
    walletTransaction: { create: jest.fn().mockResolvedValue({}) },
    user: { findUniqueOrThrow: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    subscription: { findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_existing' }), upsert: jest.fn() },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  };
  const connectService = { payoutOrLedgerOnly: jest.fn().mockResolvedValue({ stripeTransferId: null }) };
  const service = new MastermindService(prisma, buildConfig() as any, connectService as any);
  return { service, prisma, connectService };
}

describe('MastermindService', () => {
  it('createSession() rejects a scheduledFor in the past', async () => {
    const { service } = buildDeps();
    await expect(
      service.createSession('host-1', {
        title: 'Growth hacking',
        accessFee: 50,
        currency: Currency.USD,
        scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('bookSession() rejects booking your own session', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue({
      id: 'session-1',
      hostId: 'host-1',
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(service.bookSession('host-1', 'session-1')).rejects.toThrow(BadRequestException);
  });

  it('bookSession() rejects a duplicate booking', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue({
      id: 'session-1',
      hostId: 'host-1',
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });
    prisma.mastermindBooking.findUnique.mockResolvedValue({ id: 'existing-booking' });

    await expect(service.bookSession('client-1', 'session-1')).rejects.toThrow(BadRequestException);
  });

  it('completeBooking() splits the fee 80/20 and credits only the host wallet', async () => {
    const { service, prisma, connectService } = buildDeps();
    prisma.mastermindBooking.findUnique.mockResolvedValue(null);
    prisma.liveMastermindSession.findUnique.mockResolvedValue({ id: 'session-1', currency: Currency.USD });

    const checkoutSession: any = {
      id: 'cs_123',
      amount_total: 10000, // $100.00
      metadata: { userId: 'client-1', sessionId: 'session-1', hostId: 'host-1' },
    };

    await service.completeBooking(checkoutSession);

    expect(prisma.mastermindBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: 'session-1', userId: 'client-1' }) }),
    );
    const walletAmount = prisma.walletTransaction.create.mock.calls[0][0].data.amount;
    expect(walletAmount.toString()).toBe('80'); // 100 * (1 - 0.2)
    expect(connectService.payoutOrLedgerOnly).toHaveBeenCalledWith('host-1', 80, Currency.USD, expect.any(Object));
  });

  it('completeBooking() is idempotent against duplicate webhook delivery', async () => {
    const { service, prisma } = buildDeps();
    prisma.mastermindBooking.findUnique.mockResolvedValue({ id: 'already-booked' });

    await service.completeBooking({
      id: 'cs_123',
      amount_total: 10000,
      metadata: { userId: 'client-1', sessionId: 'session-1', hostId: 'host-1' },
    } as any);

    expect(prisma.mastermindBooking.create).not.toHaveBeenCalled();
  });

  it('getAccess() lets the host in without a booking', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue({
      id: 'session-1',
      hostId: 'host-1',
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
      liveStreamUrl: 'https://zoom.example/live',
      title: 'Growth hacking',
    });

    const access = await service.getAccess('host-1', 'session-1');
    expect(access.liveStreamUrl).toBe('https://zoom.example/live');
  });

  it('getAccess() blocks a non-host without a paid booking', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue({
      id: 'session-1',
      hostId: 'host-1',
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
      liveStreamUrl: 'https://zoom.example/live',
    });
    prisma.mastermindBooking.findUnique.mockResolvedValue(null);

    await expect(service.getAccess('client-1', 'session-1')).rejects.toThrow(ForbiddenException);
  });

  it('getAccess() blocks a booked client before the early-access window opens', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue({
      id: 'session-1',
      hostId: 'host-1',
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000), // 1h away — outside the 15min window
      liveStreamUrl: 'https://zoom.example/live',
    });
    prisma.mastermindBooking.findUnique.mockResolvedValue({ id: 'booking-1' });

    await expect(service.getAccess('client-1', 'session-1')).rejects.toThrow(ForbiddenException);
  });

  it('getAccess() lets a booked client in once inside the early-access window', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue({
      id: 'session-1',
      hostId: 'host-1',
      scheduledFor: new Date(Date.now() + 5 * 60 * 1000), // 5 min away — inside the 15min window
      liveStreamUrl: 'https://zoom.example/live',
      title: 'Growth hacking',
    });
    prisma.mastermindBooking.findUnique.mockResolvedValue({ id: 'booking-1' });

    const access = await service.getAccess('client-1', 'session-1');
    expect(access.liveStreamUrl).toBe('https://zoom.example/live');
  });

  it('getAccess() throws when the host has not published a stream link yet', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue({
      id: 'session-1',
      hostId: 'host-1',
      scheduledFor: new Date(Date.now() + 60 * 1000),
      liveStreamUrl: null,
    });

    await expect(service.getAccess('host-1', 'session-1')).rejects.toThrow(BadRequestException);
  });

  it('getAccess() throws NotFoundException for an unknown session', async () => {
    const { service, prisma } = buildDeps();
    prisma.liveMastermindSession.findUnique.mockResolvedValue(null);

    await expect(service.getAccess('user-1', 'nope')).rejects.toThrow(NotFoundException);
  });
});
