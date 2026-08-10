import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, PostStatus, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { encodeCursor, decodeCursor } from '../../common/pagination/cursor.util';
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

export interface FeedPage {
  items: FeedItem[];
  // Null once every underlying stream is exhausted — the client's signal to stop asking for more.
  nextCursor: string | null;
}

const LOCAL_RADIUS_METERS = 20_000;

/** Keyset cursor state — one entry per sub-stream `discover()` can draw from. */
interface FeedCursor {
  global: GlobalStreamCursor | null; // null = stream exhausted, not "no cursor yet"
  local: LocalStreamCursor | null;
}
interface GlobalStreamCursor {
  likesCount: number;
  viewsCount: number;
  createdAt: string; // ISO — the row-value tuple comparison in SQL needs a literal, not a JS Date
  id: string;
}
interface LocalStreamCursor {
  createdAt: string;
  id: string;
}

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

  /**
   * Keyset ("cursor") pagination, not OFFSET — see cursor.util.ts. Every
   * page after the first is an index seek on the sort columns instead of a
   * scan-and-discard of `offset` rows, so query cost stays flat as a user
   * scrolls deep into the feed instead of growing with how far they've gone.
   */
  async discover(userId: string, query: DiscoverFeedQueryDto): Promise<FeedPage> {
    const isPremium = await this.hasPremiumAccess(userId);
    const limit = query.limit ?? 20;
    // No cursor at all => first page for both streams. Once decoded,
    // `global`/`local` being `null` specifically means "this stream was
    // already exhausted on a previous page" — don't query it again.
    const decoded = decodeCursor<FeedCursor>(query.cursor);
    const globalExhausted = decoded !== null && decoded.global === null;
    const localExhausted = decoded !== null && decoded.local === null;
    const globalAfter = decoded?.global ?? null;
    const localAfter = decoded?.local ?? null;

    if (!isPremium || query.lat === undefined || query.lng === undefined) {
      const { rows, nextCursor } = await this.fetchGlobalPosts(limit, globalAfter, globalExhausted);
      return {
        items: rows.map((p) => this.toFeedItem(p, 'CLOUD')),
        nextCursor: nextCursor ? encodeCursor({ global: nextCursor, local: null } satisfies FeedCursor) : null,
      };
    }

    // Premium/Pro: interleave global high-engagement posts with posts from
    // providers within 20km, roughly 1:1, so the feed reads as a healthy mix
    // rather than a wall of one or the other.
    const half = Math.ceil(limit / 2);
    const [globalResult, localResult] = await Promise.all([
      this.fetchGlobalPosts(half, globalAfter, globalExhausted),
      this.fetchLocalPosts(query.lat, query.lng, half, localAfter, localExhausted),
    ]);

    const interleaved: FeedItem[] = [];
    const maxLen = Math.max(globalResult.rows.length, localResult.rows.length);
    for (let i = 0; i < maxLen; i++) {
      if (globalResult.rows[i]) interleaved.push(this.toFeedItem(globalResult.rows[i], 'CLOUD'));
      if (localResult.rows[i]) interleaved.push(this.toFeedItem(localResult.rows[i], 'LOCAL'));
    }

    const bothExhausted = !globalResult.nextCursor && !localResult.nextCursor;
    return {
      items: interleaved.slice(0, limit),
      nextCursor: bothExhausted
        ? null
        : encodeCursor({ global: globalResult.nextCursor ?? null, local: localResult.nextCursor ?? null } satisfies FeedCursor),
    };
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

  private async fetchGlobalPosts(
    limit: number,
    after: GlobalStreamCursor | null,
    exhausted: boolean,
  ): Promise<{ rows: any[]; nextCursor: GlobalStreamCursor | null }> {
    if (exhausted) return { rows: [], nextCursor: null };

    // Two-step: raw SQL picks the correctly-ordered page of IDs via a tuple
    // (row-value) comparison — the standard keyset-pagination technique for
    // a multi-column ORDER BY, which Prisma's built-in `cursor` option can't
    // express — then Prisma re-fetches those rows with their full
    // tags/creator relations and we restore the SQL's ordering (`IN` doesn't
    // preserve it).
    const seekRows = await this.prisma.$queryRaw<
      Array<{ id: string; likesCount: number; viewsCount: number; createdAt: Date }>
    >(Prisma.sql`
      SELECT id, likes_count AS "likesCount", views_count AS "viewsCount", created_at AS "createdAt"
      FROM discovery_posts
      WHERE status = 'PUBLISHED'
        ${
          after
            ? Prisma.sql`AND (likes_count, views_count, created_at, id) < (${after.likesCount}, ${after.viewsCount}, ${after.createdAt}::timestamp, ${after.id})`
            : Prisma.empty
        }
      ORDER BY likes_count DESC, views_count DESC, created_at DESC, id DESC
      LIMIT ${limit};
    `);

    if (seekRows.length === 0) return { rows: [], nextCursor: null };

    const posts = await this.prisma.discoveryPost.findMany({
      where: { id: { in: seekRows.map((r) => r.id) } },
      include: { tags: true, user: { select: { id: true, profile: { select: { name: true } } } } },
    });
    const byId = new Map(posts.map((p) => [p.id, p]));
    const rows = seekRows.map((r) => byId.get(r.id)).filter(Boolean);

    const last = seekRows[seekRows.length - 1];
    const nextCursor: GlobalStreamCursor | null =
      seekRows.length < limit
        ? null // fewer rows than asked for => this stream is exhausted
        : { likesCount: last.likesCount, viewsCount: last.viewsCount, createdAt: last.createdAt.toISOString(), id: last.id };

    return { rows, nextCursor };
  }

  private async fetchLocalPosts(
    lat: number,
    lng: number,
    limit: number,
    after: LocalStreamCursor | null,
    exhausted: boolean,
  ): Promise<{ rows: any[]; nextCursor: LocalStreamCursor | null }> {
    if (exhausted) return { rows: [], nextCursor: null };

    const rows = await this.prisma.$queryRaw<
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
        ${
          after
            ? Prisma.sql`AND (dp.created_at, dp.id) < (${after.createdAt}::timestamp, ${after.id})`
            : Prisma.empty
        }
      ORDER BY dp.created_at DESC, dp.id DESC
      LIMIT ${limit};
    `);

    const last = rows[rows.length - 1];
    const nextCursor: LocalStreamCursor | null =
      rows.length < limit || !last ? null : { createdAt: last.createdAt.toISOString(), id: last.id };

    return { rows, nextCursor };
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
