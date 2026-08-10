import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateProfileDto, NearbyQueryDto } from './dto/update-profile.dto';
import { Prisma, Role } from '@prisma/client';

export interface NearbyProvider {
  userId: string;
  name: string;
  bio: string;
  skills: string[];
  averageRating: number;
  hourlyRate: string | null;
  rateCurrency: string;
  financialHealthScore: number | null;
  distanceMeters: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: { user: { select: { role: true, currentMode: true, country: true } } },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.getProfile(userId); // 404s early if the profile doesn't exist
    return this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...dto,
        hourlyRate: dto.hourlyRate !== undefined ? new Prisma.Decimal(dto.hourlyRate) : undefined,
      },
    });
  }

  /**
   * "Modo Local": PostGIS-backed radius search. We keep raw lat/lng columns
   * (see schema.prisma) and compute the geography comparison on the fly with
   * ST_MakePoint + ST_DWithin/ST_Distance rather than maintaining a synced
   * `geography` column — simpler for an MVP, same index-ability if a GiST
   * index is later added on (longitude, latitude).
   *
   * Only PROVIDER/BOTH users are returned, matching the swipe-stack semantics
   * used by SwipesService.
   */
  async findNearby(query: NearbyQueryDto): Promise<NearbyProvider[]> {
    const radiusMeters = (query.radiusKm ?? 25) * 1000;

    const rows = await this.prisma.$queryRaw<NearbyProvider[]>(Prisma.sql`
      SELECT
        up.user_id                    AS "userId",
        up.name                       AS "name",
        up.bio                        AS "bio",
        up.skills                     AS "skills",
        up.average_rating             AS "averageRating",
        up.hourly_rate                AS "hourlyRate",
        up.rate_currency              AS "rateCurrency",
        ps.financial_health_score     AS "financialHealthScore",
        ST_Distance(
          ST_MakePoint(up.longitude, up.latitude)::geography,
          ST_MakePoint(${query.lng}, ${query.lat})::geography
        ) AS "distanceMeters"
      FROM user_profiles up
      INNER JOIN users u ON u.id = up.user_id
      LEFT JOIN provider_scores ps ON ps.provider_id = up.user_id
      WHERE up.latitude IS NOT NULL
        AND up.longitude IS NOT NULL
        AND u.role IN ('PROVIDER', 'BOTH')
        AND ST_DWithin(
          ST_MakePoint(up.longitude, up.latitude)::geography,
          ST_MakePoint(${query.lng}, ${query.lat})::geography,
          ${radiusMeters}
        )
      ORDER BY "distanceMeters" ASC
      LIMIT ${query.limit ?? 20}
      OFFSET ${query.offset ?? 0};
    `);

    return rows;
  }

  async getScore(providerId: string) {
    const score = await this.prisma.providerScore.findUnique({ where: { providerId } });
    if (!score) {
      throw new NotFoundException('This user has no provider score yet');
    }
    return score;
  }

  async isProvider(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    return user?.role === Role.PROVIDER || user?.role === Role.BOTH;
  }

  /** Called on every app boot so push notifications always target the current device. */
  async updateFcmToken(userId: string, fcmToken: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { fcmToken } });
    return { updated: true };
  }
}
