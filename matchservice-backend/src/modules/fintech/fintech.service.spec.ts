import { BadRequestException } from '@nestjs/common';
import { Currency, WalletTransactionType } from '@prisma/client';
import { FintechService } from './fintech.service';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

/** Yield to the microtask queue so two in-flight calls actually interleave. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * In-memory stand-in for the wallet row.
 *
 * `updateMany` models what Postgres actually guarantees: the `walletBalance
 * >= amount` predicate and the decrement are evaluated as ONE indivisible
 * step. The `await tick()` sits BEFORE that step, so both concurrent callers
 * are guaranteed to be inside `withdraw()` at the same time — which is
 * precisely the window the old implementation lost money in (it read the
 * balance with `findUnique`, awaited, then decremented unconditionally).
 */
function buildWalletPrisma(
  initialBalance: number,
  userOverrides: Record<string, unknown> = {},
) {
  const state = { walletBalance: initialBalance };
  const rows: any[] = [];

  return {
    __state: state,
    __rows: rows,
    user: {
      findUnique: jest.fn(async () => {
        // Snapshot BEFORE the delay: two requests on two connections both
        // observe the pre-withdrawal balance. This is exactly the stale read
        // the old `if (walletBalance < amount) throw` check trusted.
        const snapshot = state.walletBalance;
        await tick();
        return {
          id: 'user-1',
          country: 'US',
          walletBalance: snapshot,
          stripeConnectAccountId: null,
          stripeConnectPayoutsEnabled: false,
          ...userOverrides,
        };
      }),
      findUniqueOrThrow: jest.fn(async () => ({ walletBalance: state.walletBalance })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        await tick();
        const floor = Number(where.walletBalance?.gte ?? 0);
        if (state.walletBalance < floor) return { count: 0 };
        state.walletBalance -= Number(data.walletBalance.decrement);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        if (data.walletBalance?.increment) {
          state.walletBalance += Number(data.walletBalance.increment);
        }
        if (data.walletBalance?.decrement) {
          state.walletBalance -= Number(data.walletBalance.decrement);
        }
        return { walletBalance: state.walletBalance };
      }),
    },
    walletTransaction: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `tx-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    // Prisma's array form: the ops are already promises by the time they get
    // here, so awaiting them all is the faithful mock.
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  };
}

describe('FintechService.withdraw — concurrent withdrawal race', () => {
  it('lets exactly one of two concurrent withdrawals through when the balance only covers one', async () => {
    // 100 in the wallet, two simultaneous requests for 60 each.
    const prisma = buildWalletPrisma(100);
    const connectService = { requestPayout: jest.fn() };
    const service = new FintechService(prisma as any, buildConfig() as any, connectService as any);

    const results = await Promise.allSettled([
      service.withdraw('user-1', 60),
      service.withdraw('user-1', 60),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/Insufficient wallet balance/);

    // The whole point: the balance must never go negative.
    expect(prisma.__state.walletBalance).toBe(40);
    expect(prisma.__state.walletBalance).toBeGreaterThanOrEqual(0);

    // And exactly one debit was written to the ledger.
    const debits = prisma.__rows.filter((r) => r.type === WalletTransactionType.WITHDRAWAL);
    expect(debits).toHaveLength(1);
    expect(Number(debits[0].amount)).toBe(-60);
  });

  it('keeps the balance non-negative under five concurrent withdrawals that only two can cover', async () => {
    const prisma = buildWalletPrisma(100);
    const connectService = { requestPayout: jest.fn() };
    const service = new FintechService(prisma as any, buildConfig() as any, connectService as any);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.withdraw('user-1', 50)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    expect(prisma.__state.walletBalance).toBe(0);
  });

  it('reserves the balance BEFORE the real payout, and compensates when the payout fails', async () => {
    const prisma = buildWalletPrisma(100, {
      country: 'BR',
      stripeConnectAccountId: 'acct_123',
      stripeConnectPayoutsEnabled: true,
    });
    const requestPayout = jest.fn(async () => {
      // At the moment Stripe is called the funds must already be reserved.
      expect(prisma.__state.walletBalance).toBe(40);
      throw new Error('insufficient platform balance');
    });
    const service = new FintechService(
      prisma as any,
      buildConfig() as any,
      { requestPayout } as any,
    );

    await expect(service.withdraw('user-1', 60)).rejects.toThrow('insufficient platform balance');

    expect(requestPayout).toHaveBeenCalledWith('user-1', 60, Currency.BRL);
    // Compensated: balance restored, and the reversal is explicit in the ledger.
    expect(prisma.__state.walletBalance).toBe(100);
    const reversal = prisma.__rows.find((r) => r.metadata?.kind === 'withdrawal_reversal');
    expect(reversal).toBeDefined();
    expect(Number(reversal.amount)).toBe(60);
    expect(reversal.type).toBe(WalletTransactionType.DEPOSIT);
  });

  it('records the Stripe payout id on the ledger row when the payout succeeds', async () => {
    const prisma = buildWalletPrisma(100, {
      stripeConnectAccountId: 'acct_123',
      stripeConnectPayoutsEnabled: true,
    });
    const service = new FintechService(
      prisma as any,
      buildConfig() as any,
      { requestPayout: jest.fn().mockResolvedValue({ id: 'po_123' }) } as any,
    );

    const result = await service.withdraw('user-1', 60);

    expect(result.realPayout).toBe(true);
    expect(prisma.__state.walletBalance).toBe(40);
    const debit = prisma.__rows.find((r) => r.type === WalletTransactionType.WITHDRAWAL);
    expect(debit.metadata).toEqual({ stripePayoutId: 'po_123' });
  });
});
