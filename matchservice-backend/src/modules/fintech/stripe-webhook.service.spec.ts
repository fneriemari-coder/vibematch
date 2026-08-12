import { StripeWebhookService } from './stripe-webhook.service';
import { Currency } from '@prisma/client';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

// Only reached by the mentorship_booking branch, which these tests do not
// exercise — present so the constructor arity matches.
const mentorshipService = { completeBooking: jest.fn() };

describe('StripeWebhookService — maintenance revenue split', () => {
  it('splits a paid maintenance invoice 85/15 (default take rate) and credits only the provider wallet', async () => {
    const prisma: any = {
      maintenanceAgreement: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'agreement-1',
          providerId: 'provider-1',
          currency: Currency.USD,
          platformTakeRate: 0.15,
        }),
      },
      walletTransaction: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    };
    const academyService = { completePurchase: jest.fn() };
    const mastermindService = { completeBooking: jest.fn() };
    const communitiesService = { completeMembership: jest.fn() };
    const connectService = { payoutOrLedgerOnly: jest.fn().mockResolvedValue({ stripeTransferId: null }) };

    const service = new StripeWebhookService(prisma, buildConfig() as any, academyService as any, mastermindService as any, communitiesService as any, mentorshipService as any, connectService as any);

    const invoice: any = { id: 'in_123', amount_paid: 20000 }; // $200.00 in cents

    await (service as any).handleMaintenanceInvoicePaid('agreement-1', invoice);

    expect(prisma.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'provider-1',
          amount: expect.objectContaining({}), // Prisma.Decimal instance
        }),
      }),
    );

    const createdAmount = prisma.walletTransaction.create.mock.calls[0][0].data.amount;
    expect(createdAmount.toString()).toBe('170'); // 200 * 0.85

    expect(connectService.payoutOrLedgerOnly).toHaveBeenCalledWith(
      'provider-1',
      170,
      Currency.USD,
      expect.objectContaining({ kind: 'maintenance_revenue' }),
    );
  });

  it('respects a custom platformTakeRate stored on the agreement', async () => {
    const prisma: any = {
      maintenanceAgreement: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'agreement-2',
          providerId: 'provider-2',
          currency: Currency.BRL,
          platformTakeRate: 0.25,
        }),
      },
      walletTransaction: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    };
    const academyService = { completePurchase: jest.fn() };
    const mastermindService = { completeBooking: jest.fn() };
    const communitiesService = { completeMembership: jest.fn() };
    const connectService = { payoutOrLedgerOnly: jest.fn().mockResolvedValue({ stripeTransferId: null }) };
    const service = new StripeWebhookService(prisma, buildConfig() as any, academyService as any, mastermindService as any, communitiesService as any, mentorshipService as any, connectService as any);

    await (service as any).handleMaintenanceInvoicePaid('agreement-2', { id: 'in_456', amount_paid: 10000 });

    const createdAmount = prisma.walletTransaction.create.mock.calls[0][0].data.amount;
    expect(createdAmount.toString()).toBe('75'); // 100 * (1 - 0.25)
  });
});
