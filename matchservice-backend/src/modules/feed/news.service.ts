import { Injectable, NotFoundException } from '@nestjs/common';
import { NewsCategory, NewsMediaKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.util';
import { ListNewsQueryDto } from './dto/list-news-query.dto';
import { SavedNewsQueryDto } from './dto/saved-news-query.dto';

/** One card in the Radar feed. Flat on purpose — the client never has to join. */
export interface NewsFeedItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string | null;
  videoUrl: string | null;
  author: string | null;
  category: NewsCategory;
  mediaKind: NewsMediaKind;
  publishedAt: Date;
  /** Always shown on the card — attribution is the deal we make with publishers. */
  sourceName: string;
  sourceSiteUrl: string;
  viewsCount: number;
  /** Whether the *calling* user has bookmarked this item. */
  saved: boolean;
}

export interface NewsFeedPage {
  items: NewsFeedItem[];
  nextCursor: string | null;
  /** Categories that actually have at least one item — drives the filter bar. */
  categories: NewsCategory[];
}

/** Keyset state for the news list: `publishedAt DESC, id DESC`. */
interface NewsCursor {
  publishedAt: string; // ISO — a JS Date can't survive base64/JSON round-tripping
  id: string;
}

/** Keyset state for the saved list, which is ordered by when the user saved it. */
interface SavedCursor {
  createdAt: string;
  id: string;
}

const NEWS_ITEM_SELECT = {
  id: true,
  title: true,
  summary: true,
  url: true,
  imageUrl: true,
  videoUrl: true,
  author: true,
  category: true,
  mediaKind: true,
  publishedAt: true,
  viewsCount: true,
  source: { select: { name: true, siteUrl: true } },
} satisfies Prisma.NewsItemSelect;

type NewsItemRow = Prisma.NewsItemGetPayload<{ select: typeof NEWS_ITEM_SELECT }>;

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keyset ("cursor") pagination, not OFFSET — see cursor.util.ts. This feed
   * is explicitly designed to be scrolled forever, so page cost has to stay
   * flat instead of growing with how deep the user has gone.
   */
  async listNews(userId: string, query: ListNewsQueryDto): Promise<NewsFeedPage> {
    const limit = query.limit ?? 20;
    const after = decodeCursor<NewsCursor>(query.cursor);

    // Collected as an AND list rather than merged into one object: both the
    // free-text search and the keyset seek want the top-level `OR` slot, and
    // spreading them into a single literal would silently drop one of them.
    const filters: Prisma.NewsItemWhereInput[] = [];
    if (query.category) filters.push({ category: query.category });
    if (query.mediaKind) filters.push({ mediaKind: query.mediaKind });
    if (query.search) {
      filters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { summary: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    if (after) {
      // Row-value comparison on the (publishedAt, id) sort tuple — the seek
      // predicate that makes this a keyset query rather than an offset scan.
      filters.push({
        OR: [
          { publishedAt: { lt: new Date(after.publishedAt) } },
          { publishedAt: new Date(after.publishedAt), id: { lt: after.id } },
        ],
      });
    }

    const [rows, categories] = await Promise.all([
      this.prisma.newsItem.findMany({
        where: filters.length > 0 ? { AND: filters } : {},
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: NEWS_ITEM_SELECT,
      }),
      this.listPopulatedCategories(),
    ]);

    const savedIds = await this.savedIdsFor(userId, rows.map((r) => r.id));
    const last = rows[rows.length - 1];

    return {
      items: rows.map((row) => this.toFeedItem(row, savedIds.has(row.id))),
      // Fewer rows than asked for => there is no next page.
      nextCursor:
        rows.length < limit || !last
          ? null
          : encodeCursor({ publishedAt: last.publishedAt.toISOString(), id: last.id } satisfies NewsCursor),
      categories,
    };
  }

  /** The caller's bookmarks, newest save first — same card shape as the main feed. */
  async listSaved(userId: string, query: SavedNewsQueryDto): Promise<NewsFeedPage> {
    const limit = query.limit ?? 20;
    const after = decodeCursor<SavedCursor>(query.cursor);

    const rows = await this.prisma.savedNewsItem.findMany({
      where: {
        userId,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: new Date(after.createdAt) } },
                { createdAt: new Date(after.createdAt), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, createdAt: true, newsItem: { select: NEWS_ITEM_SELECT } },
    });

    const last = rows[rows.length - 1];

    return {
      // Everything in this list is saved by definition.
      items: rows.map((row) => this.toFeedItem(row.newsItem, true)),
      nextCursor:
        rows.length < limit || !last
          ? null
          : encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id } satisfies SavedCursor),
      categories: await this.listPopulatedCategories(),
    };
  }

  /**
   * Idempotent: the [userId, newsItemId] unique means a double-tap (or a
   * retried request on a flaky mobile connection) can't inflate savesCount.
   */
  async save(userId: string, newsItemId: string): Promise<{ saved: true; savesCount: number }> {
    await this.assertItemExists(newsItemId);

    const created = await this.prisma.savedNewsItem
      .create({ data: { userId, newsItemId } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
        throw err;
      });

    const item = created
      ? await this.prisma.newsItem.update({
          where: { id: newsItemId },
          data: { savesCount: { increment: 1 } },
          select: { savesCount: true },
        })
      : await this.prisma.newsItem.findUniqueOrThrow({
          where: { id: newsItemId },
          select: { savesCount: true },
        });

    return { saved: true, savesCount: item.savesCount };
  }

  /** Also idempotent — un-saving something that was never saved is a no-op, not a 404. */
  async unsave(userId: string, newsItemId: string): Promise<{ saved: false; savesCount: number }> {
    await this.assertItemExists(newsItemId);

    const { count } = await this.prisma.savedNewsItem.deleteMany({ where: { userId, newsItemId } });

    const item =
      count > 0
        ? await this.prisma.newsItem.update({
            where: { id: newsItemId },
            // Clamped at 0 in the (impossible-by-constraint, but cheap to
            // defend) case of a counter drift.
            data: { savesCount: { decrement: 1 } },
            select: { savesCount: true },
          })
        : await this.prisma.newsItem.findUniqueOrThrow({ where: { id: newsItemId }, select: { savesCount: true } });

    return { saved: false, savesCount: Math.max(0, item.savesCount) };
  }

  /** Fire-and-forget impression counter — the route answers 204. */
  async registerView(newsItemId: string): Promise<void> {
    await this.assertItemExists(newsItemId);
    await this.prisma.newsItem.update({
      where: { id: newsItemId },
      data: { viewsCount: { increment: 1 } },
      select: { id: true },
    });
  }

  /**
   * Only categories with at least one ingested item, so the client never
   * renders a filter chip that leads to an empty screen.
   */
  private async listPopulatedCategories(): Promise<NewsCategory[]> {
    const grouped = await this.prisma.newsItem.groupBy({ by: ['category'] });
    return grouped.map((g) => g.category).sort();
  }

  private async savedIdsFor(userId: string, itemIds: string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const saved = await this.prisma.savedNewsItem.findMany({
      where: { userId, newsItemId: { in: itemIds } },
      select: { newsItemId: true },
    });
    return new Set(saved.map((s) => s.newsItemId));
  }

  private async assertItemExists(newsItemId: string): Promise<void> {
    const exists = await this.prisma.newsItem.findUnique({ where: { id: newsItemId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Conteúdo não encontrado');
  }

  private toFeedItem(row: NewsItemRow, saved: boolean): NewsFeedItem {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      url: row.url,
      imageUrl: row.imageUrl,
      videoUrl: row.videoUrl,
      author: row.author,
      category: row.category,
      mediaKind: row.mediaKind,
      publishedAt: row.publishedAt,
      sourceName: row.source.name,
      sourceSiteUrl: row.source.siteUrl,
      viewsCount: row.viewsCount,
      saved,
    };
  }
}
