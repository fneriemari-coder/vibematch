import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, PostStatus, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiModeratorService } from '../ai/ai-moderator.service';
import { DiscoverFeedQueryDto } from './dto/discover-feed-query.dto';
import { CreatePostDto } from './dto/create-post.dto';

export interface FeedItem {
  postId: string;
  title: string;
  contentText: string;
  mediaUrl: string | null;
  videoDurationSeconds: number | null;
  likesCount: number;
  viewsCount: number;
  createdAt: Date;
  creator: { id: string; name: string };
  // First tag on the post — the trigger for the "Implementar no meu Negócio" contextual match.
  skillTagId: string | null;
  source: 'CLOUD' | 'LOCAL';
}

const LOCAL_RADIUS_METERS = 20_000;

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiModeratorService: AiModeratorService,
  ) {}

  /**
   * Gates every user-submitted post through AiModeratorService before it can
   * ever appear in the public feed. A blocked post is still persisted (for
   * audit/appeal) with status BLOCKED — fetchGlobalPosts/fetchLocalPosts never
   * query for it — but the request itself fails with 422 so callers (mobile
   * app, stress tests) can classify success/block purely off HTTP status
   * instead of having to inspect the response body.
   */
  async createPost(userId: string, dto: CreatePostDto) {
    const verdict = await this.aiModeratorService.moderate(dto.contentText, dto.tags);

    const post = await this.prisma.discoveryPost.create({
      data: {
        userId,
        title: dto.title,
        contentText: dto.contentText,
        mediaUrl: dto.mediaUrl,
        videoDurationSeconds: dto.videoDurationSeconds,
        status: verdict.allowed ? PostStatus.PUBLISHED : PostStatus.BLOCKED,
        moderationReason: verdict.reason,
        tags: { create: dto.tags.map((tagName) => ({ tagName })) },
      },
    });

    if (!verdict.allowed) {
      throw new UnprocessableEntityException({
        message: 'Conteúdo fora de diretrizes. O VIBE MATCH mantém o feed focado estritamente em soluções e serviços profissionais. Revise sua publicação.',
        postId: post.id,
        reason: verdict.reason,
      });
    }

    return { id: post.id, status: post.status };
  }

  async discover(userId: string, query: DiscoverFeedQueryDto): Promise<FeedItem[]> {
    const isPremium = await this.hasPremiumAccess(userId);
    const limit = query.limit ?? 20;

    if (!isPremium || query.lat === undefined || query.lng === undefined) {
      const globalPosts = await this.fetchGlobalPosts(limit, query.offset ?? 0);
      return globalPosts.map((p) => this.toFeedItem(p, 'CLOUD'));
    }

    // Premium/Pro: interleave global high-engagement posts with posts from
    // providers within 20km, roughly 1:1, so the feed reads as a healthy mix
    // rather than a wall of one or the other.
    const half = Math.ceil(limit / 2);
    const [globalPosts, localPosts] = await Promise.all([
      this.fetchGlobalPosts(half, 0),
      this.fetchLocalPosts(query.lat, query.lng, half),
    ]);

    const interleaved: FeedItem[] = [];
    const maxLen = Math.max(globalPosts.length, localPosts.length);
    for (let i = 0; i < maxLen; i++) {
      if (globalPosts[i]) interleaved.push(this.toFeedItem(globalPosts[i], 'CLOUD'));
      if (localPosts[i]) interleaved.push(this.toFeedItem(localPosts[i], 'LOCAL'));
    }
    return interleaved.slice(0, limit);
  }

  private async hasPremiumAccess(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
    const isActive =
      subscription?.status === SubscriptionStatus.ACTIVE &&
      (!subscription.expiresAt || subscription.expiresAt > new Date());
    return (
      isActive &&
      (subscription.tier === SubscriptionTier.PREMIUM_CLIENT ||
        subscription.tier === SubscriptionTier.PRO_PROVIDER)
    );
  }

  private fetchGlobalPosts(limit: number, offset: number) {
    return this.prisma.discoveryPost.findMany({
      where: { status: PostStatus.PUBLISHED },
      orderBy: [{ likesCount: 'desc' }, { viewsCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
      include: { tags: true, user: { select: { id: true, profile: { select: { name: true } } } } },
    });
  }

  private async fetchLocalPosts(lat: number, lng: number, limit: number) {
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        contentText: string;
        mediaUrl: string | null;
        videoDurationSeconds: number | null;
        likesCount: number;
        viewsCount: number;
        createdAt: Date;
        creatorId: string;
        creatorName: string;
      }>
    >(Prisma.sql`
      SELECT
        dp.id                     AS "id",
        dp.title                  AS "title",
        dp.content_text           AS "contentText",
        dp.media_url              AS "mediaUrl",
        dp.video_duration_seconds AS "videoDurationSeconds",
        dp.likes_count            AS "likesCount",
        dp.views_count            AS "viewsCount",
        dp.created_at             AS "createdAt",
        u.id                      AS "creatorId",
        up.name                   AS "creatorName"
      FROM discovery_posts dp
      INNER JOIN users u ON u.id = dp.user_id
      INNER JOIN user_profiles up ON up.user_id = u.id
      WHERE dp.status = 'PUBLISHED'
        AND up.latitude IS NOT NULL AND up.longitude IS NOT NULL
        AND ST_DWithin(
          ST_MakePoint(up.longitude, up.latitude)::geography,
          ST_MakePoint(${lng}, ${lat})::geography,
          ${LOCAL_RADIUS_METERS}
        )
      ORDER BY dp.created_at DESC
      LIMIT ${limit};
    `);
  }

  private toFeedItem(post: any, source: 'CLOUD' | 'LOCAL'): FeedItem {
    const isRawLocal = source === 'LOCAL';
    return {
      postId: post.id,
      title: post.title,
      contentText: isRawLocal ? post.contentText : post.contentText,
      mediaUrl: post.mediaUrl,
      videoDurationSeconds: post.videoDurationSeconds,
      likesCount: post.likesCount,
      viewsCount: post.viewsCount,
      createdAt: post.createdAt,
      creator: isRawLocal
        ? { id: post.creatorId, name: post.creatorName }
        : { id: post.user.id, name: post.user.profile?.name ?? '' },
      skillTagId: isRawLocal ? null : (post.tags?.[0]?.id ?? null),
      source,
    };
  }
}
