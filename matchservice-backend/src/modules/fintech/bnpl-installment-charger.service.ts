import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { InstallmentStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Stripe has no native "create this invoice now, charge it automatically in
 * N days" primitive for one-off invoices (that's what Subscription Schedules
 * are for, and BNPL installments aren't a subscription) — so the schedule
 * BnplService writes to `BnplInstallment` has to be walked by this cron,
 * which creates + finalizes + attempts payment on exactly the installments
 * that are due today. Runs once a day; every installment is processed
 * independently so one Stripe failure never blocks the rest of the batch.
 */
@Injectable()
export class BnplInstallmentChargerService {
  private readonly logger = new Logger(BnplInstallmentChargerService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async chargeDueInstallments(): Promise<void> {
    const due = await this.prisma.bnplInstallment.findMany({
      where: { status: InstallmentStatus.SCHEDULED, dueDate: { lte: new Date() } },
      include: { escrowProject: { include: { client: true } } },
    });

    if (due.length === 0) return;
    this.logger.log(`BNPL charger: ${due.length} installment(s) due today`);

    for (const installment of due) {
      try {
        await this.chargeOne(installment);
      } catch (err) {
        this.logger.error(
          `Installment ${installment.id} (project ${installment.escrowProjectId}) charge failed: ${(err as Error).message}`,
        );
        await this.prisma.bnplInstallment.update({
          where: { id: installment.id },
          data: { status: InstallmentStatus.FAILED, failureReason: (err as Error).message },
        });
      }
    }
  }

  private async chargeOne(installment: { id: string; amount: unknown; currency: string; escrowProject: { client: { id: string } }; escrowProjectId: string }) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId: installment.escrowProject.client.id },
    });
    const stripeCustomerId = subscription?.stripeCustomerId;
    if (!stripeCustomerId) {
      throw new Error('Client has no Stripe customer on file — cannot collect installment');
    }

    const amountMinor = Math.round(Number(installment.amount) * 100);

    await this.stripe.invoiceItems.create({
      customer: stripeCustomerId,
      amount: amountMinor,
      currency: installment.currency.toLowerCase(),
      description: `MatchService BNPL installment — project ${installment.escrowProjectId}`,
    });

    const invoice = await this.stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: 'charge_automatically',
      auto_advance: true,
      metadata: { escrowProjectId: installment.escrowProjectId, installmentId: installment.id },
    });

    const finalized = await this.stripe.invoices.finalizeInvoice(invoice.id);

    // Always record the Stripe invoice id, regardless of outcome, so
    // stripe-webhook.service.ts can resolve `invoice.paid` /
    // `invoice.payment_failed` back to this exact installment later — an
    // async-settling payment method (3DS, boleto, SEPA) confirms or fails
    // well after this call returns.
    if (finalized.status === 'paid') {
      await this.prisma.bnplInstallment.update({
        where: { id: installment.id },
        data: { status: InstallmentStatus.CHARGED, stripeInvoiceId: finalized.id, chargedAt: new Date() },
      });
      this.logger.log(`Installment ${installment.id} charged synchronously via Stripe invoice ${finalized.id}`);
    } else {
      // Still SCHEDULED — left for the webhook to resolve. stripeInvoiceId is
      // set now so that resolution can find this row.
      await this.prisma.bnplInstallment.update({
        where: { id: installment.id },
        data: { stripeInvoiceId: finalized.id },
      });
      this.logger.log(
        `Installment ${installment.id}: invoice ${finalized.id} finalized as '${finalized.status}' — awaiting async confirmation via webhook`,
      );
    }
  }
}
