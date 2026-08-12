import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma, SubscriptionStatus, SubscriptionTier, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  boletoOptions,
  oneOffPaymentMethods,
} from '../../common/payments/payment-methods.util';
import { ConnectService } from '../fintech/connect.service';

// Instructor keeps 80% of every course sale; the platform's 20% covers
// distribution, hosting, and payment processing — see completePurchase().
const PLATFORM_TAKE_RATE = 0.2;
const PREMIUM_CLIENT_DISCOUNT_RATE = 0.1;

// Hard ceiling on how many mentor profiles listMentors() will ever pull into
// memory to rank — see the doc comment there for why the sort can't be pushed
// into SQL. The curated group is orders of magnitude smaller than this today.
const MENTOR_SORT_WINDOW = 500;

/**
 * VibeAcademy purchases. Money only ever moves in response to a REAL Stripe
 * event (`checkout.session.completed`) — `initiatePurchase` just opens a
 * Checkout Session and returns its URL; it never grants access or credits a
 * wallet itself. See StripeWebhookService.handleCheckoutSessionCompleted,
 * which calls back into `completePurchase` below.
 */
@Injectable()
export class AcademyService {
  private readonly logger = new Logger(AcademyService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connectService: ConnectService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });
  }

  async initiatePurchase(userId: string, courseId: string) {
    const course = await this.prisma.businessCourse.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.instructorId === userId) {
      throw new BadRequestException('You cannot purchase your own course');
    }

    const existingEnrollment = await this.prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existingEnrollment) {
      throw new BadRequestException('You are already enrolled in this course');
    }

    const isPremiumClient = await this.isActivePremiumClient(userId);
    const discountRate = isPremiumClient ? PREMIUM_CLIENT_DISCOUNT_RATE : 0;
    const finalPrice = Number((Number(course.price) * (1 - discountRate)).toFixed(2));

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const stripeCustomerId = await this.ensureStripeCustomer(userId, user.email);

    const appUrl = this.config.get('APP_URL') ?? 'https://app.matchservice.dev';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      // Boleto and Pix for BRL, cards elsewhere — see the util for why this
      // cannot be a constant.
      payment_method_types: oneOffPaymentMethods(course.currency),
      payment_method_options: boletoOptions(course.currency),
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: course.currency.toLowerCase(),
            unit_amount: Math.round(finalPrice * 100),
            product_data: { name: course.title },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/academy/purchase-success`,
      cancel_url: `${appUrl}/academy/purchase-cancel`,
      metadata: {
        kind: 'course_purchase',
        userId,
        courseId,
        instructorId: course.instructorId,
        currency: course.currency,
      },
    });

    this.logger.log(
      `Checkout session ${session.id} created for user ${userId} buying course ${courseId} at ${finalPrice} ${course.currency} (discount ${discountRate * 100}%)`,
    );

    return { checkoutUrl: session.url, finalPrice, discountApplied: discountRate };
  }

  /** Called by StripeWebhookService once `checkout.session.completed` confirms real payment. */
  async completePurchase(session: Stripe.Checkout.Session): Promise<void> {
    const { userId, courseId, instructorId } = session.metadata ?? {};
    if (!userId || !courseId || !instructorId) {
      this.logger.warn(`checkout.session.completed for course purchase missing metadata (session ${session.id})`);
      return;
    }

    const existingEnrollment = await this.prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existingEnrollment) {
      this.logger.debug(`Enrollment already exists for user ${userId}/course ${courseId} — ignoring duplicate webhook`);
      return;
    }

    const course = await this.prisma.businessCourse.findUnique({ where: { id: courseId } });
    if (!course) {
      this.logger.error(`checkout.session.completed for unknown course ${courseId} (session ${session.id})`);
      return;
    }

    const amountPaid = (session.amount_total ?? 0) / 100;
    const instructorShare = Number((amountPaid * (1 - PLATFORM_TAKE_RATE)).toFixed(2));
    const platformShare = Number((amountPaid - instructorShare).toFixed(2));

    await this.prisma.$transaction([
      this.prisma.courseEnrollment.create({
        data: {
          userId,
          courseId,
          pricePaid: new Prisma.Decimal(amountPaid),
          currency: course.currency,
        },
      }),
      this.prisma.walletTransaction.create({
        data: {
          userId: instructorId,
          type: WalletTransactionType.COURSE_REVENUE,
          amount: new Prisma.Decimal(instructorShare),
          currency: course.currency,
          metadata: { courseId, checkoutSessionId: session.id, grossAmount: amountPaid, platformShare },
        },
      }),
      this.prisma.user.update({
        where: { id: instructorId },
        data: { walletBalance: { increment: new Prisma.Decimal(instructorShare) } },
      }),
    ]);

    const { stripeTransferId } = await this.connectService.payoutOrLedgerOnly(
      instructorId,
      instructorShare,
      course.currency,
      { kind: 'course_revenue', courseId, checkoutSessionId: session.id },
    );

    this.logger.log(
      `Course purchase completed: user ${userId} enrolled in ${courseId}, instructor ${instructorId} paid ` +
        `${instructorShare} ${course.currency} (platform kept ${platformShare})` +
        (stripeTransferId ? ` — real transfer ${stripeTransferId}` : ' — ledger only, Connect not onboarded'),
    );
  }

  /** Full course detail for the Flutter VibeAcademyScreen — course + ordered modules. */
  /**
   * Course catalogue for the Academy tab. Until this existed a course could
   * only be opened by id — via a retention-push deep link — so there was no
   * way to browse the catalogue at all from inside the app.
   *
   * Carries the per-course `enrolled` flag so a card can render "Continuar"
   * instead of a price without the client making a request per course.
   */
  async listCourses(userId: string, search?: string, limit = 20, offset = 0) {
    const where: Prisma.BusinessCourseWhereInput = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { skillsTaught: { hasSome: [search.toUpperCase()] } },
          ],
        }
      : {};

    const [courses, total, enrollments] = await this.prisma.$transaction([
      this.prisma.businessCourse.findMany({
        where,
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        include: {
          instructor: { select: { id: true, profile: { select: { name: true } } } },
          _count: { select: { modules: true, enrollments: true } },
        },
      }),
      this.prisma.businessCourse.count({ where }),
      this.prisma.courseEnrollment.findMany({ where: { userId }, select: { courseId: true } }),
    ]);

    const enrolledIds = new Set(enrollments.map((e) => e.courseId));

    return {
      courses: courses.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        price: c.price,
        currency: c.currency,
        rating: c.rating,
        mediaPreviewUrl: c.mediaPreviewUrl,
        skillsTaught: c.skillsTaught,
        instructorName: c.instructor.profile?.name ?? 'Instrutor',
        moduleCount: c._count.modules,
        studentCount: c._count.enrollments,
        enrolled: enrolledIds.has(c.id),
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Curated mentors directory (GET /academy/mentors). `isMentor` is granted
   * by an admin (PATCH /admin/users/:userId/mentor), never self-set, so this
   * stays an editorial group rather than "everyone who ticked a box".
   *
   * Ordering (K-Score desc, then rating desc) happens in memory on purpose:
   * K-Score lives on the optional ProviderScore relation, and Postgres sorts
   * a LEFT-JOINed NULL FIRST under a DESC ordering — which would float
   * mentors with no score row to the top, the exact opposite of "missing
   * score counts as 0". MENTOR_SORT_WINDOW caps what is ever pulled into
   * memory so this can't degrade silently as the group grows.
   */
  async listMentors(search?: string, limit = 20, offset = 0) {
    const where: Prisma.UserProfileWhereInput = {
      isMentor: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { bio: { contains: search, mode: 'insensitive' } },
              { mentorHeadline: { contains: search, mode: 'insensitive' } },
              { skills: { hasSome: [search, search.toUpperCase()] } },
              { mentorTopics: { hasSome: [search] } },
            ],
          }
        : {}),
    };

    const [profiles, total] = await this.prisma.$transaction([
      this.prisma.userProfile.findMany({
        where,
        take: MENTOR_SORT_WINDOW,
        include: {
          user: { select: { id: true, score: { select: { financialHealthScore: true } } } },
        },
      }),
      this.prisma.userProfile.count({ where }),
    ]);

    const ranked = profiles
      .map((p) => ({ profile: p, kScore: p.user.score?.financialHealthScore ?? 0 }))
      .sort((a, b) => b.kScore - a.kScore || b.profile.averageRating - a.profile.averageRating);

    const page = ranked.slice(offset, offset + limit);
    const userIds = page.map((m) => m.profile.userId);

    const [courseCounts, sessionCounts] = await Promise.all([
      this.prisma.businessCourse.groupBy({
        by: ['instructorId'],
        where: { instructorId: { in: userIds } },
        _count: { _all: true },
      }),
      this.prisma.liveMastermindSession.groupBy({
        by: ['hostId'],
        where: { hostId: { in: userIds }, scheduledFor: { gte: new Date() } },
        _count: { _all: true },
      }),
    ]);

    const coursesByUser = new Map(courseCounts.map((c) => [c.instructorId, c._count._all]));
    const sessionsByUser = new Map(sessionCounts.map((s) => [s.hostId, s._count._all]));

    return {
      mentors: page.map(({ profile, kScore }) => ({
        // The USER id, not the profile id — every other route the client will
        // follow this card into (chat, swipe, mastermind booking) is keyed on
        // the user.
        id: profile.userId,
        name: profile.name,
        headline: profile.mentorHeadline,
        bio: profile.bio,
        skills: profile.skills,
        topics: profile.mentorTopics,
        averageRating: profile.averageRating,
        kScore,
        hourlyRate: profile.hourlyRate,
        rateCurrency: profile.rateCurrency,
        courseCount: coursesByUser.get(profile.userId) ?? 0,
        upcomingSessionCount: sessionsByUser.get(profile.userId) ?? 0,
      })),
      total,
      limit,
      offset,
    };
  }

  async getCourseDetail(courseId: string) {
    const course = await this.prisma.businessCourse.findUnique({
      where: { id: courseId },
      include: {
        modules: { orderBy: { orderIndex: 'asc' } },
        instructor: { select: { id: true, profile: { select: { name: true } } } },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async getCourseConnections(courseId: string) {
    const course = await this.prisma.businessCourse.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    if (course.skillsTaught.length === 0) {
      return { skillsTaught: [], profiles: [], posts: [] };
    }

    const [profiles, posts] = await Promise.all([
      this.prisma.userProfile.findMany({
        where: {
          skills: { hasSome: course.skillsTaught },
          user: { role: { in: ['PROVIDER', 'BOTH'] } },
        },
        orderBy: { averageRating: 'desc' },
        take: 20,
      }),
      this.prisma.discoveryPost.findMany({
        where: {
          status: 'PUBLISHED',
          tags: { some: { tagName: { in: course.skillsTaught } } },
        },
        orderBy: { likesCount: 'desc' },
        take: 10,
        include: { tags: true, user: { select: { id: true, profile: { select: { name: true } } } } },
      }),
    ]);

    return { skillsTaught: course.skillsTaught, profiles, posts };
  }

  private async isActivePremiumClient(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    const isActive =
      subscription?.status === SubscriptionStatus.ACTIVE &&
      (!subscription.expiresAt || subscription.expiresAt > new Date());
    return isActive && subscription.tier === SubscriptionTier.PREMIUM_CLIENT;
  }

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
