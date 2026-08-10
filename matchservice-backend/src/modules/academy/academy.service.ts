import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma, SubscriptionStatus, SubscriptionTier, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConnectService } from '../fintech/connect.service';

// Instructor keeps 80% of every course sale; the platform's 20% covers
// distribution, hosting, and payment processing — see completePurchase().
const PLATFORM_TAKE_RATE = 0.2;
const PREMIUM_CLIENT_DISCOUNT_RATE = 0.1;

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
