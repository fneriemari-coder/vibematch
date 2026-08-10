import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, SwipeDirection, SwipeMode, MatchType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateSwipeDto } from './dto/create-swipe.dto';
import { StackQueryDto } from './dto/stack-query.dto';

export interface StackCandidate {
  userId: string;
  name: string;
  bio: string;
  skills: string[];
  averageRating: number;
  hourlyRate: string | null;
  rateCurrency: string;
  financialHealthScore: number | null;
  distanceMeters?: number;
  isProBoosted?: boolean;
}

@Injectable()
export class SwipesService {
  private readonly logger = new Logger(SwipesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // A) Stack generation — one branch per mode, per the product spec.
  // ---------------------------------------------------------------------

  async getStack(viewerId: string, query: StackQueryDto): Promise<StackCandidate[]> {
    switch (query.mode) {
      case SwipeMode.CLOUD:
        return this.getCloudStack(viewerId, query.limit ?? 20);
      case SwipeMode.LOCAL:
        if (query.lat === undefined || query.lng === undefined) {
          throw new BadRequestException('Local mode requires lat/lng');
        }
        return this.getLocalStack(viewerId, query.lat, query.lng, query.radiusKm ?? 25, query.limit ?? 20);
      case SwipeMode.B2B:
        return this.getB2BStack(viewerId, query.limit ?? 20);
      default:
        throw new BadRequestException(`Unsupported mode: ${query.mode}`);
    }
  }

  /**
   * Modo Nuvem (Global): every PROVIDER/BOTH user, worldwide, location ignored.
   * PRO_PROVIDER subscribers get an algorithmic boost — they're ordered first,
   * simulating a paid-visibility feed rather than a purely chronological one.
   */
  private async getCloudStack(viewerId: string, limit: number): Promise<StackCandidate[]> {
    const excluded = await this.alreadySwipedIds(viewerId, SwipeMode.CLOUD);

    const rows = await this.prisma.$queryRaw<StackCandidate[]>(Prisma.sql`
      SELECT
        up.user_id                AS "userId",
        up.name                   AS "name",
        up.bio                    AS "bio",
        up.skills                 AS "skills",
        up.average_rating         AS "averageRating",
        up.hourly_rate            AS "hourlyRate",
        up.rate_currency          AS "rateCurrency",
        ps.financial_health_score AS "financialHealthScore",
        (s.tier = 'PRO_PROVIDER' AND s.status = 'ACTIVE') AS "isProBoosted"
      FROM user_profiles up
      INNER JOIN users u ON u.id = up.user_id
      LEFT JOIN provider_scores ps ON ps.provider_id = up.user_id
      LEFT JOIN subscriptions s ON s.user_id = up.user_id
      WHERE u.role IN ('PROVIDER', 'BOTH')
        AND up.user_id != ${viewerId}
        AND up.user_id NOT IN (${Prisma.join(excluded.length ? excluded : [''])})
      ORDER BY "isProBoosted" DESC NULLS LAST, ps.financial_health_score DESC NULLS LAST
      LIMIT ${limit};
    `);

    return rows;
  }

  /** Modo Local: PostGIS radius search, reusing the same ST_DWithin pattern as UsersService. */
  private async getLocalStack(
    viewerId: string,
    lat: number,
    lng: number,
    radiusKm: number,
    limit: number,
  ): Promise<StackCandidate[]> {
    const excluded = await this.alreadySwipedIds(viewerId, SwipeMode.LOCAL);
    const radiusMeters = radiusKm * 1000;

    const rows = await this.prisma.$queryRaw<StackCandidate[]>(Prisma.sql`
      SELECT
        up.user_id                AS "userId",
        up.name                   AS "name",
        up.bio                    AS "bio",
        up.skills                 AS "skills",
        up.average_rating         AS "averageRating",
        up.hourly_rate            AS "hourlyRate",
        up.rate_currency          AS "rateCurrency",
        ps.financial_health_score AS "financialHealthScore",
        ST_Distance(
          ST_MakePoint(up.longitude, up.latitude)::geography,
          ST_MakePoint(${lng}, ${lat})::geography
        ) AS "distanceMeters"
      FROM user_profiles up
      INNER JOIN users u ON u.id = up.user_id
      LEFT JOIN provider_scores ps ON ps.provider_id = up.user_id
      WHERE u.role IN ('PROVIDER', 'BOTH')
        AND up.user_id != ${viewerId}
        AND up.latitude IS NOT NULL
        AND up.longitude IS NOT NULL
        AND up.user_id NOT IN (${Prisma.join(excluded.length ? excluded : [''])})
        AND ST_DWithin(
          ST_MakePoint(up.longitude, up.latitude)::geography,
          ST_MakePoint(${lng}, ${lat})::geography,
          ${radiusMeters}
        )
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit};
    `);

    return rows;
  }

  /**
   * Modo Tinder B2B (Networking): anyone (CLIENT, PROVIDER or BOTH) who opted
   * into b2b_networking. This is a peer-to-peer partnership feed, not a
   * client-hires-provider feed, so role is intentionally unfiltered.
   */
  private async getB2BStack(viewerId: string, limit: number): Promise<StackCandidate[]> {
    const excluded = await this.alreadySwipedIds(viewerId, SwipeMode.B2B);

    const rows = await this.prisma.$queryRaw<StackCandidate[]>(Prisma.sql`
      SELECT
        up.user_id                AS "userId",
        up.name                   AS "name",
        up.bio                    AS "bio",
        up.skills                 AS "skills",
        up.average_rating         AS "averageRating",
        up.hourly_rate            AS "hourlyRate",
        up.rate_currency          AS "rateCurrency",
        ps.financial_health_score AS "financialHealthScore"
      FROM user_profiles up
      INNER JOIN users u ON u.id = up.user_id
      LEFT JOIN provider_scores ps ON ps.provider_id = up.user_id
      WHERE up.b2b_networking = true
        AND up.user_id != ${viewerId}
        AND up.user_id NOT IN (${Prisma.join(excluded.length ? excluded : [''])})
      ORDER BY up.updated_at DESC
      LIMIT ${limit};
    `);

    return rows;
  }

  private async alreadySwipedIds(viewerId: string, mode: SwipeMode): Promise<string[]> {
    const swipes = await this.prisma.swipe.findMany({
      where: { swiperId: viewerId, mode },
      select: { swipedId: true },
    });
    return swipes.map((s) => s.swipedId);
  }

  // ---------------------------------------------------------------------
  // B) Recording a swipe + double opt-in match detection.
  // ---------------------------------------------------------------------

  /**
   * Records a swipe. If it's a LIKE and the other user already LIKEd the
   * viewer back in the same mode, atomically creates the Match (double
   * opt-in). Duplicate swipes (already swiped this user in this mode) are a
   * no-op that returns the existing record instead of erroring — swipe UIs
   * routinely re-fire on fast taps/network retries.
   */
  async swipe(viewerId: string, dto: CreateSwipeDto) {
    if (viewerId === dto.swipedId) {
      throw new BadRequestException('You cannot swipe on your own profile');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.swipe.findUnique({
        where: {
          swiperId_swipedId_mode: {
            swiperId: viewerId,
            swipedId: dto.swipedId,
            mode: dto.mode,
          },
        },
      });
      if (existing) {
        return { swipe: existing, match: null, alreadySwiped: true };
      }

      const swipe = await tx.swipe.create({
        data: {
          swiperId: viewerId,
          swipedId: dto.swipedId,
          direction: dto.direction,
          mode: dto.mode,
        },
      });

      if (dto.direction !== SwipeDirection.LIKE) {
        return { swipe, match: null, alreadySwiped: false };
      }

      const reciprocal = await tx.swipe.findUnique({
        where: {
          swiperId_swipedId_mode: {
            swiperId: dto.swipedId,
            swipedId: viewerId,
            mode: dto.mode,
          },
        },
      });

      if (!reciprocal || reciprocal.direction !== SwipeDirection.LIKE) {
        return { swipe, match: null, alreadySwiped: false };
      }

      // Double opt-in confirmed — create the Match. userOneId/userTwoId are
      // sorted so the (userOneId, userTwoId, type) unique constraint can't be
      // bypassed by the two sides being created in a different order.
      const [userOneId, userTwoId] = [viewerId, dto.swipedId].sort();
      const type: MatchType = dto.mode === SwipeMode.B2B ? MatchType.B2B : MatchType.SERVICE;

      const match = await tx.match.upsert({
        where: { userOneId_userTwoId_type: { userOneId, userTwoId, type } },
        create: { userOneId, userTwoId, type },
        update: {},
      });

      this.logger.log(`Match created: ${match.id} (${type}) between ${userOneId} and ${userTwoId}`);

      return { swipe, match, alreadySwiped: false };
    });
  }

  async listMyMatches(userId: string) {
    return this.prisma.match.findMany({
      where: { OR: [{ userOneId: userId }, { userTwoId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        userOne: { select: { id: true, profile: { select: { name: true } } } },
        userTwo: { select: { id: true, profile: { select: { name: true } } } },
        escrowProject: { select: { id: true, status: true } },
      },
    });
  }
}
