import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { EscrowStatus, MaintenanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ActivateMaintenanceDto } from './dto/activate-maintenance.dto';

// Default recurring fee when auto-triggered with no explicit terms: 10% of
// the original project budget, monthly — a simple, defensible retainer
// heuristic until providers start setting their own maintenance pricing.
const DEFAULT_MONTHLY_FEE_RATE = 0.1;
const DEFAULT_SUPPORT_HOURS = 5;

/**
 * "Continuous Maintenance Contracts" — turns a one-off completed project
 * into recurring hosting/support revenue. Billing is real Stripe money
 * movement (a live monthly Subscription against the client), so this
 * service only ever *creates* the subscription; the actual 85/15 revenue
 * split happens in StripeWebhookService.handleMaintenanceInvoicePaid, driven
 * by Stripe's own `invoice.paid` event — never assumed optimistically here.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  /** Explicit route handler — requester must be a party to the project. */
  async activateFromRequest(requesterId: string, dto: ActivateMaintenanceDto) {
    const project = await this.prisma.escrowProject.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (![project.clientId, project.providerId].includes(requesterId)) {
      throw new ForbiddenException('You are not a participant in this project');
    }
    return this.activate(dto.projectId, {
      monthlyFee: dto.monthlyFee,
      hostingIncluded: dto.hostingIncluded,
      supportHoursAllocated: dto.supportHoursAllocated,
    });
  }

  /**
   * Auto-trigger hook — call this after an EscrowProject transitions to
   * COMPLETED (see EscrowService.complete / AiValidatorService). Silently
   * no-ops (does not throw) if a maintenance agreement already exists for
   * the project, since both completion paths could race to call this.
   */
  async activateIfEligible(projectId: string): Promise<void> {
    try {
      const existing = await this.prisma.maintenanceAgreement.findUnique({ where: { projectId } });
      if (existing) return;
      await this.activate(projectId, {});
    } catch (err) {
      // A failure here must never unwind the project-completion transaction
      // that triggered it — completion already happened, funds already
      // moved; this is strictly a best-effort upsell.
      this.logger.error(`Auto-activation of maintenance failed for project ${projectId}: ${(err as Error).message}`);
    }
  }

  private async activate(
    projectId: string,
    overrides: { monthlyFee?: number; hostingIncluded?: boolean; supportHoursAllocated?: number },
  ) {
    const project = await this.prisma.escrowProject.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.status !== EscrowStatus.COMPLETED) {
      throw new BadRequestException('Maintenance can only be activated for a COMPLETED project');
    }

    const monthlyFee = overrides.monthlyFee ?? Number(project.budget) * DEFAULT_MONTHLY_FEE_RATE;
    const hostingIncluded = overrides.hostingIncluded ?? true;
    const supportHoursAllocated = overrides.supportHoursAllocated ?? DEFAULT_SUPPORT_HOURS;

    const stripeCustomerId = await this.ensureStripeCustomer(project.clientId, project.client.email);

    // Subscriptions' price_data requires an existing Product id (unlike
    // Checkout line_items, which accept inline product_data) — create one
    // ad-hoc per agreement.
    const product = await this.stripe.products.create({
      name: `VIBE MATCH — Manutenção contínua (projeto ${project.id.slice(0, 8)})`,
      metadata: { projectId: project.id },
    });

    const subscription = await this.stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [
        {
          price_data: {
            currency: project.currency.toLowerCase(),
            unit_amount: Math.round(monthlyFee * 100),
            recurring: { interval: 'month' },
            product: product.id,
          },
        },
      ],
      metadata: { projectId: project.id, providerId: project.providerId, kind: 'maintenance' },
    });

    const agreement = await this.prisma.maintenanceAgreement.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        providerId: project.providerId,
        monthlyFee: new Prisma.Decimal(monthlyFee),
        currency: project.currency,
        hostingIncluded,
        supportHoursAllocated,
        status: MaintenanceStatus.ACTIVE,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
      },
    });

    this.logger.log(
      `Maintenance agreement ${agreement.id} activated for project ${project.id} — ` +
        `${monthlyFee} ${project.currency}/mo (Stripe subscription ${subscription.id})`,
    );

    return agreement;
  }

  private async ensureStripeCustomer(clientId: string, email: string): Promise<string> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId: clientId } });
    if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;

    const customer = await this.stripe.customers.create({ email, metadata: { userId: clientId } });
    await this.prisma.subscription.upsert({
      where: { userId: clientId },
      update: { stripeCustomerId: customer.id },
      create: { userId: clientId, stripeCustomerId: customer.id },
    });
    return customer.id;
  }
}
