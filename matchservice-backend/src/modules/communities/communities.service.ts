import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Community, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const MEMBER_PREVIEW_LIMIT = 12;

type CommunityWithHost = Community & {
  host: { id: string; profile: { name: string } | null };
};

/**
 * Comunidades ("Círculos") — small, curated paid peer groups.
 *
 * What makes a Círculo different from a paid chat is that it sits on top of
 * the marketplace already in this codebase:
 *  - `minKScore` gates the seat on the member's real ProviderScore, so a tier
 *    is earned and not only purchased;
 *  - `askedCount`/`answeredCount`/`contributionScore` make reciprocity a
 *    tracked fact rather than a house rule — a member who only consumes can be
 *    moved to ROTATED_OUT and the seat recycled.
 *
 * Money rule, same as everywhere else here: `apply` only opens a Stripe
 * Checkout Session and writes a PENDING row. Nothing becomes ACTIVE until a
 * real `checkout.session.completed` event arrives — see
 * StripeWebhookService.handleCheckoutSessionCompleted, which calls back into
 * `completeMembership` below.
 */
@Injectable()
export class CommunitiesService {
  private readonly logger = new Logger(CommunitiesService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  async listCommunities(userId: string) {
    const [communities, activeCounts, myMemberships, kScore] = await Promise.all([
      this.prisma.community.findMany({
        orderBy: { monthlyFee: 'asc' },
        include: { host: { select: { id: true, profile: { select: { name: true } } } } },
      }),
      this.prisma.communityMembership.groupBy({
        by: ['communityId'],
        where: { status: MembershipStatus.ACTIVE },
        _count: { _all: true },
      }),
      this.prisma.communityMembership.findMany({
        where: { userId, status: MembershipStatus.ACTIVE },
        select: { communityId: true },
      }),
      this.getKScore(userId),
    ]);

    const takenByCommunity = new Map(activeCounts.map((c) => [c.communityId, c._count._all]));
    const myCommunityIds = new Set(myMemberships.map((m) => m.communityId));

    return {
      communities: communities.map((c) =>
        this.toCard(c, takenByCommunity.get(c.id) ?? 0, myCommunityIds.has(c.id), kScore),
      ),
    };
  }

  async getCommunityDetail(userId: string, communityId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      include: { host: { select: { id: true, profile: { select: { name: true } } } } },
    });
    if (!community) throw new NotFoundException('Comunidade não encontrada');

    const [members, seatsTaken, myMembership, kScore] = await Promise.all([
      this.prisma.communityMembership.findMany({
        where: { communityId, status: MembershipStatus.ACTIVE },
        orderBy: { contributionScore: 'desc' },
        take: MEMBER_PREVIEW_LIMIT,
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { name: true, mentorHeadline: true, bio: true, skills: true } },
            },
          },
        },
      }),
      this.prisma.communityMembership.count({ where: { communityId, status: MembershipStatus.ACTIVE } }),
      this.prisma.communityMembership.findUnique({
        where: { communityId_userId: { communityId, userId } },
      }),
      this.getKScore(userId),
    ]);

    return {
      ...this.toCard(community, seatsTaken, myMembership?.status === MembershipStatus.ACTIVE, kScore),
      members: members.map((m) => ({
        userId: m.userId,
        name: m.user.profile?.name ?? 'Membro',
        // Falls back to the plain bio when the member isn't a listed mentor —
        // an empty row in the member list reads as a bug to the user.
        headline: m.user.profile?.mentorHeadline ?? m.user.profile?.bio ?? '',
        skills: m.user.profile?.skills ?? [],
        contributionScore: m.contributionScore,
      })),
      myMembership: myMembership ?? null,
    };
  }

  /**
   * Opens a monthly subscription Checkout Session and parks a PENDING seat.
   *
   * Uses inline `price_data` with a monthly `recurring` rather than a
   * preconfigured Stripe Price id: community pricing lives in our own
   * `Community.monthlyFee`, and requiring a `STRIPE_PRICE_*` env var per tier
   * would make adding a Círculo an infra change instead of a data change.
   */
  async apply(userId: string, communityId: string) {
    const community = await this.prisma.community.findUnique({ where: { id: communityId } });
    if (!community) throw new NotFoundException('Comunidade não encontrada');

    const existing = await this.prisma.communityMembership.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    if (existing?.status === MembershipStatus.ACTIVE) {
      throw new BadRequestException('Você já é membro ativo desta comunidade');
    }

    const seatsTaken = await this.prisma.communityMembership.count({
      where: { communityId, status: MembershipStatus.ACTIVE },
    });
    if (seatsTaken >= community.seatLimit) {
      throw new BadRequestException(
        `Todas as ${community.seatLimit} vagas de "${community.name}" estão ocupadas no momento`,
      );
    }

    const kScore = await this.getKScore(userId);
    if (kScore < community.minKScore) {
      throw new BadRequestException(
        `Seu K-SCORE atual é ${kScore} e "${community.name}" exige no mínimo ${community.minKScore}`,
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const stripeCustomerId = await this.ensureStripeCustomer(userId, user.email);
    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: community.currency.toLowerCase(),
            unit_amount: Math.round(Number(community.monthlyFee) * 100),
            recurring: { interval: 'month' },
            product_data: { name: `${community.name} — assinatura mensal` },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/communities/join-success`,
      cancel_url: `${appUrl}/communities/join-cancel`,
      metadata: {
        kind: 'community_membership',
        userId,
        communityId,
      },
    });

    // PENDING only. The seat is not held and confers nothing until Stripe
    // confirms the subscription — see completeMembership().
    const membership = await this.prisma.communityMembership.upsert({
      where: { communityId_userId: { communityId, userId } },
      update: { status: MembershipStatus.PENDING },
      create: { communityId, userId, status: MembershipStatus.PENDING },
    });

    this.logger.log(
      `Checkout session ${session.id} opened for user ${userId} applying to community ${communityId} ` +
        `at ${community.monthlyFee} ${community.currency}/mo`,
    );

    return {
      checkoutUrl: session.url,
      membershipId: membership.id,
      status: membership.status,
      monthlyFee: community.monthlyFee,
      currency: community.currency,
    };
  }

  /**
   * Called by StripeWebhookService once `checkout.session.completed` confirms
   * the subscription. Idempotent: a retried or duplicated webhook finds the
   * membership already ACTIVE and returns without touching it.
   */
  async completeMembership(session: Stripe.Checkout.Session): Promise<void> {
    const { userId, communityId } = session.metadata ?? {};
    if (!userId || !communityId) {
      this.logger.warn(`checkout.session.completed for community membership missing metadata (session ${session.id})`);
      return;
    }

    const membership = await this.prisma.communityMembership.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });
    if (!membership) {
      this.logger.error(
        `checkout.session.completed for unknown membership (user ${userId}, community ${communityId}, session ${session.id})`,
      );
      return;
    }
    if (membership.status === MembershipStatus.ACTIVE) {
      this.logger.debug(
        `Membership ${membership.id} already ACTIVE — ignoring duplicate webhook (session ${session.id})`,
      );
      return;
    }

    const stripeSubscriptionId =
      typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);

    await this.prisma.communityMembership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.ACTIVE, stripeSubscriptionId, joinedAt: new Date() },
    });

    this.logger.log(
      `Membership ${membership.id} ACTIVE — user ${userId} joined community ${communityId}` +
        (stripeSubscriptionId ? ` (subscription ${stripeSubscriptionId})` : ''),
    );
  }

  private toCard(community: CommunityWithHost, seatsTaken: number, isMember: boolean, kScore: number) {
    return {
      id: community.id,
      tier: community.tier,
      name: community.name,
      tagline: community.tagline,
      description: community.description,
      monthlyFee: community.monthlyFee,
      currency: community.currency,
      cadence: community.cadence,
      seatLimit: community.seatLimit,
      seatsTaken,
      seatsAvailable: Math.max(0, community.seatLimit - seatsTaken),
      minKScore: community.minKScore,
      focusTopics: community.focusTopics,
      hostName: community.host.profile?.name ?? 'Anfitrião VIBE MATCH',
      hostId: community.hostId,
      isMember,
      eligible: kScore >= community.minKScore,
    };
  }

  /** No ProviderScore row yet (a brand-new client) counts as 0, not as "unranked". */
  private async getKScore(userId: string): Promise<number> {
    const score = await this.prisma.providerScore.findUnique({
      where: { providerId: userId },
      select: { financialHealthScore: true },
    });
    return score?.financialHealthScore ?? 0;
  }

  /** Same customer-resolution shape as AcademyService.ensureStripeCustomer. */
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
