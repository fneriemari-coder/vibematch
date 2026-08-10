import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Stripe Connect (Express) — turns `wallet_balance` from an internal-only
 * ledger number into real money a provider can withdraw to a bank account.
 * A provider must complete Express onboarding (identity + bank details,
 * hosted entirely by Stripe) before any real Transfer/Payout is attempted;
 * until then, every earning event still updates the ledger normally — see
 * `payoutOrLedgerOnly` below, which is what advance/BNPL/maintenance/course
 * revenue all call instead of writing to `walletBalance` directly.
 */
@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  async createOnboardingLink(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let accountId = user.stripeConnectAccountId;
    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: { transfers: { requested: true } },
        metadata: { userId },
      });
      accountId = account.id;
      await this.prisma.user.update({ where: { id: userId }, data: { stripeConnectAccountId: accountId } });
    }

    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/wallet/connect/refresh`,
      return_url: `${appUrl}/wallet/connect/complete`,
      type: 'account_onboarding',
    });

    return { url: link.url };
  }

  /** Called by StripeWebhookService on `account.updated`. */
  async syncAccountStatus(account: Stripe.Account): Promise<void> {
    const userId = account.metadata?.userId;
    if (!userId) return;

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled) },
    });

    this.logger.log(`Connect account ${account.id} for user ${userId}: payouts_enabled=${account.payouts_enabled}`);
  }

  /**
   * Always credits the ledger (source of truth for what the app displays as
   * balance). Additionally attempts a real Stripe Transfer into the
   * provider's connected account when they've completed onboarding — a
   * Transfer failure (e.g. no platform balance in test mode) is logged and
   * swallowed, since the ledger credit must never roll back because of it;
   * the transfer can be reconciled/retried independently of the business
   * event that earned the money.
   */
  async payoutOrLedgerOnly(
    providerId: string,
    amount: number,
    currency: string,
    metadata: Record<string, string | number>,
  ): Promise<{ stripeTransferId: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: providerId } });
    if (!user?.stripeConnectAccountId || !user.stripeConnectPayoutsEnabled) {
      return { stripeTransferId: null };
    }

    try {
      const transfer = await this.stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        destination: user.stripeConnectAccountId,
        metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])),
      });
      this.logger.log(`Real Stripe transfer ${transfer.id} of ${amount} ${currency} to provider ${providerId}`);
      return { stripeTransferId: transfer.id };
    } catch (err) {
      this.logger.warn(
        `Stripe transfer failed for provider ${providerId} (ledger already credited, transfer NOT retried automatically): ${(err as Error).message}`,
      );
      return { stripeTransferId: null };
    }
  }

  /** Real bank payout — requires completed onboarding; unlike earnings, this is NOT allowed to silently no-op. */
  async requestPayout(providerId: string, amount: number, currency: string): Promise<Stripe.Payout> {
    const user = await this.prisma.user.findUnique({ where: { id: providerId } });
    if (!user?.stripeConnectAccountId || !user.stripeConnectPayoutsEnabled) {
      throw new BadRequestException({
        code: 'CONNECT_NOT_ONBOARDED',
        message: 'Payouts not enabled — complete Stripe Connect onboarding first',
        onboardUrl: '/fintech/connect/onboard',
      });
    }

    return this.stripe.payouts.create(
      { amount: Math.round(amount * 100), currency: currency.toLowerCase() },
      { stripeAccount: user.stripeConnectAccountId },
    );
  }
}
