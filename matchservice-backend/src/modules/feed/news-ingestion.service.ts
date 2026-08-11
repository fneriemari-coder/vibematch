/**
 * Radar — external content ingestion.
 *
 * ---------------------------------------------------------------------------
 * WHAT WE STORE, AND WHY WE DELIBERATELY STORE SO LITTLE
 * ---------------------------------------------------------------------------
 * This service persists ONLY the fields a feed reader is entitled to keep:
 * the headline, the publisher's OWN description/summary (stripped of HTML and
 * truncated), a thumbnail URL, the author, and a link back to the original
 * article. It does NOT fetch the article page, and it does NOT store the
 * article body.
 *
 * That is not an oversight or a TODO — it is the whole legal posture of the
 * feature. Publishing an RSS/Atom feed is an invitation to syndicate the
 * headline+excerpt and drive traffic back to the publisher, which is exactly
 * what we do: every card in the app links out to the source, and the source
 * name is always shown. Scraping and storing the full body would turn this
 * from "an RSS reader" into "a republisher of someone else's copyrighted
 * article", which is a completely different (and indefensible) thing.
 *
 * So: do not "improve" this by fetching `item.link` and saving the page. If
 * a richer excerpt is ever needed, negotiate a licence with the publisher.
 * ---------------------------------------------------------------------------
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NewsSource, Prisma } from '@prisma/client';
import Parser from 'rss-parser';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Hard ceiling on how much of a publisher's excerpt we keep. */
const SUMMARY_MAX_CHARS = 320;
/** Third-party hosts hang. Anything slower than this is treated as down. */
const FETCH_TIMEOUT_MS = 10_000;
/** Per-source, per-run item cap — a feed with 200 entries can't dominate a run. */
const MAX_ITEMS_PER_SOURCE = 30;

/** One item as extracted from a feed, before it is written to the DB. */
export interface ParsedFeedItem {
  externalId: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string | null;
  videoUrl: string | null;
  author: string | null;
  publishedAt: Date;
}

/** Per-source outcome of one ingestion run — what POST /admin/news/refresh returns. */
export interface SourceIngestionResult {
  sourceId: string;
  sourceName: string;
  feedUrl: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  error: string | null;
}

export interface IngestionRunResult {
  sources: SourceIngestionResult[];
  totalCreated: number;
  totalUpdated: number;
  totalErrors: number;
}

/**
 * xml2js keeps unknown elements as `[{ $: { ...attrs }, _: 'text' }]`.
 * rss-parser hands those arrays through untouched when a custom field is
 * declared with `keepArray`, which is precisely what image extraction needs
 * (the URL lives in an attribute, not in the element text).
 */
type XmlNode = { $?: Record<string, string>; _?: string; [key: string]: unknown };

/** The shape rss-parser produces for one entry once our custom fields are applied. */
interface RawFeedItem {
  title?: string;
  link?: string;
  guid?: string;
  id?: string;
  pubDate?: string;
  isoDate?: string;
  author?: string;
  creator?: string;
  summary?: string;
  content?: string;
  'content:encoded'?: string;
  mediaContent?: XmlNode[];
  mediaThumbnail?: XmlNode[];
  mediaGroup?: XmlNode[];
  enclosure?: { url?: string; type?: string };
}

@Injectable()
export class NewsIngestionService {
  private readonly logger = new Logger(NewsIngestionService.name);

  /**
   * Media-namespace elements are declared with `keepArray` so the raw
   * attribute bag survives — `media:content url="..."` is an attribute, and
   * rss-parser's default flattening would throw it away.
   */
  private readonly parser = new Parser<Record<string, unknown>, RawFeedItem>({
    customFields: {
      item: [
        ['media:content', 'mediaContent', { keepArray: true }],
        ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
        ['media:group', 'mediaGroup', { keepArray: true }],
      ],
    },
  });

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ScheduleModule.forRoot() is already registered globally in AppModule —
   * declaring it again here would double-register every cron in the app.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyIngestion(): Promise<void> {
    const result = await this.ingestAllSources();
    this.logger.log(
      `Radar ingestion: ${result.totalCreated} new, ${result.totalUpdated} updated, ` +
        `${result.totalErrors} source(s) failed across ${result.sources.length} source(s)`,
    );
  }

  /**
   * Runs every active source. A source is fetched, parsed and upserted inside
   * its own try/catch: these are third-party hosts that go down, rate-limit,
   * return HTML error pages and serve malformed XML constantly, and ONE of
   * them failing must never cost us the other seventeen. The failure is
   * recorded on the row (`lastError`) instead of thrown, so an operator can
   * see which feed rotted without reading logs.
   */
  async ingestAllSources(): Promise<IngestionRunResult> {
    const sources = await this.prisma.newsSource.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });

    const results: SourceIngestionResult[] = [];
    for (const source of sources) {
      results.push(await this.ingestSource(source));
    }

    return {
      sources: results,
      totalCreated: results.reduce((sum, r) => sum + r.created, 0),
      totalUpdated: results.reduce((sum, r) => sum + r.updated, 0),
      totalErrors: results.filter((r) => r.error !== null).length,
    };
  }

  async ingestSource(source: NewsSource): Promise<SourceIngestionResult> {
    const result: SourceIngestionResult = {
      sourceId: source.id,
      sourceName: source.name,
      feedUrl: source.feedUrl,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      error: null,
    };

    try {
      const xml = await this.fetchFeed(source.feedUrl);
      const items = await this.parseFeed(xml, source.mediaKind === 'VIDEO');
      result.fetched = items.length;

      const capped = items.slice(0, MAX_ITEMS_PER_SOURCE);
      result.skipped = items.length - capped.length;

      for (const item of capped) {
        const written = await this.upsertItem(source, item);
        if (written === 'created') result.created += 1;
        else result.updated += 1;
      }

      await this.prisma.newsSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: null },
      });
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown ingestion error';
      result.error = message;
      this.logger.warn(`Radar source "${source.name}" failed: ${message}`);
      await this.prisma.newsSource
        .update({
          where: { id: source.id },
          data: { lastFetchedAt: new Date(), lastError: message.slice(0, 500) },
        })
        // A DB write failing while recording a fetch failure must not abort
        // the whole run either.
        .catch(() => undefined);
    }

    return result;
  }

  /**
   * Plain `fetch` with an abort timeout rather than rss-parser's own
   * `parseURL`, so the 10s ceiling covers DNS + connect + body download as one
   * budget and so the transport stays trivially mockable in tests.
   */
  private async fetchFeed(feedUrl: string): Promise<string> {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'VibeMatchRadar/1.0 (+https://vibematch.app)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  /**
   * Handles RSS 2.0 (`<item>`, `<pubDate>`, `<description>`) and Atom
   * (`<entry>`, `<published>`/`<updated>`, `<summary>`) alike — rss-parser
   * normalizes both shapes onto the same item object, which is why it was
   * chosen over hand-rolling xml2js.
   *
   * @param isVideoSource true for YouTube-style channel feeds, where the
   *   entry itself is the video and `media:group` carries the thumbnail.
   */
  async parseFeed(xml: string, isVideoSource = false): Promise<ParsedFeedItem[]> {
    const feed = await this.parser.parseString(xml);
    const parsed: ParsedFeedItem[] = [];

    for (const raw of feed.items as RawFeedItem[]) {
      const title = this.text(raw.title);
      const url = this.text(raw.link);
      // A feed entry with no headline or no destination is unrenderable and
      // unlinkable — there is nothing to show and nowhere to send the user.
      if (!title || !url) continue;

      const mediaGroup = this.firstNode(raw.mediaGroup);

      parsed.push({
        // The feed's own guid is the stable identity; when a feed omits one
        // (plenty do) the link is the only thing that is stable per entry.
        externalId: this.text(raw.guid) || this.text(raw.id) || url,
        title,
        summary: this.buildSummary(raw, mediaGroup),
        url,
        imageUrl: this.extractImageUrl(raw, mediaGroup, isVideoSource),
        videoUrl: isVideoSource ? url : null,
        author: this.text(raw.creator) || this.text(raw.author) || null,
        publishedAt: this.parseDate(raw),
      });
    }

    return parsed;
  }

  /**
   * The publisher's own excerpt, HTML-stripped and truncated. Atom entries
   * put it in `<summary>`; RSS puts it in `<description>` (which rss-parser
   * surfaces as `content`); YouTube puts it in `media:group > media:description`.
   * `content:encoded` is the last resort — it is often the full body, which is
   * exactly why we truncate hard rather than keeping it.
   */
  private buildSummary(raw: RawFeedItem, mediaGroup: XmlNode | null): string {
    const candidate =
      this.text(raw.summary) ||
      this.text(raw.content) ||
      this.nodeText(mediaGroup, 'media:description') ||
      this.text(raw['content:encoded']);

    return this.truncate(this.stripHtml(candidate), SUMMARY_MAX_CHARS);
  }

  /**
   * Priority order, tuned against what real feeds actually ship. Returns null
   * rather than guessing — a fabricated image URL is worse than no image,
   * because it renders as a permanently broken card.
   *
   *   1. media:content[url]      (Media RSS — most Brazilian news feeds)
   *   2. media:thumbnail[url]
   *   3. enclosure[url]          (only when type is image/*)
   *   4. first <img src> inside content:encoded / description HTML
   *   5. null
   *
   * YouTube channel feeds are special-cased first: the entry carries
   * `media:group`, and the thumbnail lives inside it.
   */
  private extractImageUrl(raw: RawFeedItem, mediaGroup: XmlNode | null, isVideoSource: boolean): string | null {
    if (isVideoSource || mediaGroup) {
      const groupThumb = this.attrFromChild(mediaGroup, 'media:thumbnail', 'url');
      if (groupThumb) return groupThumb;
      const groupContent = this.attrFromChild(mediaGroup, 'media:content', 'url');
      if (groupContent) return groupContent;
    }

    const mediaContent = this.pickImageAttr(raw.mediaContent);
    if (mediaContent) return mediaContent;

    const mediaThumbnail = this.pickImageAttr(raw.mediaThumbnail);
    if (mediaThumbnail) return mediaThumbnail;

    const enclosure = raw.enclosure;
    if (enclosure?.url && (enclosure.type ?? '').toLowerCase().startsWith('image/')) {
      return enclosure.url;
    }

    return this.firstImgSrc(this.text(raw['content:encoded'])) ?? this.firstImgSrc(this.text(raw.content));
  }

  /**
   * `media:content` legitimately describes video and audio too (a podcast
   * feed's enclosure, for instance). Only take a node that is an image, or
   * one that declares no type at all — most news feeds omit it and mean an
   * image.
   */
  private pickImageAttr(nodes: XmlNode[] | undefined): string | null {
    for (const node of nodes ?? []) {
      const url = node?.$?.url;
      if (!url) continue;
      const type = (node.$?.type ?? '').toLowerCase();
      const medium = (node.$?.medium ?? '').toLowerCase();
      if (type && !type.startsWith('image/')) continue;
      if (medium && medium !== 'image') continue;
      return url;
    }
    return null;
  }

  private attrFromChild(parent: XmlNode | null, childName: string, attr: string): string | null {
    if (!parent) return null;
    const children = parent[childName];
    if (!Array.isArray(children)) return null;
    for (const child of children as XmlNode[]) {
      const value = child?.$?.[attr];
      if (value) return value;
    }
    return null;
  }

  private nodeText(parent: XmlNode | null, childName: string): string {
    if (!parent) return '';
    const children = parent[childName];
    if (!Array.isArray(children) || children.length === 0) return '';
    return this.text(children[0]);
  }

  private firstNode(nodes: XmlNode[] | undefined): XmlNode | null {
    return Array.isArray(nodes) && nodes.length > 0 ? nodes[0] : null;
  }

  /** First `<img src="...">` in a blob of feed HTML, or null. */
  private firstImgSrc(html: string): string | null {
    if (!html) return null;
    const match = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
    const src = match?.[1]?.trim();
    if (!src) return null;
    // Data URIs and protocol-relative junk aren't usable as a stored image URL.
    return src.startsWith('http://') || src.startsWith('https://') ? src : null;
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    // Cut on a word boundary when one is close by, so the excerpt doesn't end
    // mid-word.
    const slice = value.slice(0, max);
    const lastSpace = slice.lastIndexOf(' ');
    return `${(lastSpace > max - 40 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
  }

  /**
   * Atom's `<published>`/`<updated>` and RSS's `<pubDate>` both land on
   * `isoDate`/`pubDate`. A feed with an unparseable or missing date still
   * gets ingested — dated "now" — rather than being dropped, because an
   * item nobody can see is worse than an item ordered slightly wrong.
   */
  private parseDate(raw: RawFeedItem): Date {
    for (const candidate of [raw.isoDate, raw.pubDate]) {
      if (!candidate) continue;
      const date = new Date(candidate);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return new Date();
  }

  /** Coerces xml2js's `string | { _: string }` into a plain string. */
  private text(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object' && typeof (value as XmlNode)._ === 'string') {
      return ((value as XmlNode)._ as string).trim();
    }
    return '';
  }

  /**
   * Upsert on the [sourceId, externalId] unique — re-running ingestion (cron
   * or the admin route) refreshes an entry in place instead of duplicating
   * it. viewsCount/savesCount are deliberately absent from the update payload
   * so engagement survives a re-fetch.
   */
  private async upsertItem(source: NewsSource, item: ParsedFeedItem): Promise<'created' | 'updated'> {
    const shared = {
      title: item.title,
      summary: item.summary,
      url: item.url,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
      author: item.author,
      category: source.category,
      mediaKind: source.mediaKind,
      publishedAt: item.publishedAt,
    } satisfies Omit<Prisma.NewsItemUncheckedCreateInput, 'sourceId' | 'externalId'>;

    const existing = await this.prisma.newsItem.findUnique({
      where: { sourceId_externalId: { sourceId: source.id, externalId: item.externalId } },
      select: { id: true },
    });

    await this.prisma.newsItem.upsert({
      where: { sourceId_externalId: { sourceId: source.id, externalId: item.externalId } },
      create: { sourceId: source.id, externalId: item.externalId, ...shared },
      update: shared,
    });

    return existing ? 'updated' : 'created';
  }
}
