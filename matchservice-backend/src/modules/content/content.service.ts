import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ArticleCategory, ArticleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { GenerateArticleDto } from './dto/generate-article.dto';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';
import { ArticleGeneratorService, GeneratedArticle } from './article-generator.service';

const WORDS_PER_MINUTE = 200;

/** Everything a list/related card needs — the detail route adds `body` on top. */
const ARTICLE_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageUrl: true,
  category: true,
  readMinutes: true,
  aiGenerated: true,
  publishedAt: true,
  viewCount: true,
  authorId: true,
  author: { select: { profile: { select: { name: true } } } },
} satisfies Prisma.ArticleSelect;

type ArticleCard = Prisma.ArticleGetPayload<{ select: typeof ARTICLE_CARD_SELECT }>;

/**
 * "Conteúdo" — the editorial hub. Reads are open to any authenticated user;
 * writes always create the article under the caller's own authorId, so
 * there's no way to publish in someone else's name.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: ArticleGeneratorService,
  ) {}

  async listArticles(query: ListArticlesQueryDto) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const where: Prisma.ArticleWhereInput = {
      status: ArticleStatus.PUBLISHED,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { excerpt: { contains: query.search, mode: 'insensitive' } },
              { body: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [articles, total, categoryGroups] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        select: ARTICLE_CARD_SELECT,
        orderBy: { publishedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.article.count({ where }),
      // Filter bar contents. Deliberately NOT narrowed by the current
      // category/search filter — the client needs the full set of usable
      // filters, not just the one already selected.
      this.prisma.article.groupBy({
        by: ['category'],
        where: { status: ArticleStatus.PUBLISHED },
        orderBy: { category: 'asc' },
      }),
    ]);

    return {
      articles: articles.map((a) => this.toCard(a)),
      total,
      categories: this.orderCategories(categoryGroups.map((g) => g.category)),
      limit,
      offset,
    };
  }

  /**
   * Full article by its public slug. Bumps `viewCount` on every read — an
   * unconditional increment rather than a read-modify-write, so concurrent
   * readers can't lose counts to a race.
   */
  async getArticleBySlug(slug: string) {
    const article = await this.prisma.article.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED },
      select: { ...ARTICLE_CARD_SELECT, body: true },
    });
    if (!article) throw new NotFoundException('Artigo não encontrado');

    const [updated, related] = await this.prisma.$transaction([
      this.prisma.article.update({
        where: { id: article.id },
        data: { viewCount: { increment: 1 } },
        select: { viewCount: true },
      }),
      this.prisma.article.findMany({
        where: {
          status: ArticleStatus.PUBLISHED,
          category: article.category,
          id: { not: article.id },
        },
        select: ARTICLE_CARD_SELECT,
        orderBy: { publishedAt: 'desc' },
        take: 3,
      }),
    ]);

    return {
      ...this.toCard(article),
      body: article.body,
      viewCount: updated.viewCount,
      related: related.map((r) => this.toCard(r)),
    };
  }

  /** A user publishing their own piece. Slug and reading time are derived here, never trusted from the body. */
  async createArticle(authorId: string, dto: CreateArticleDto) {
    return this.persist(authorId, dto.category, dto, dto.coverImageUrl ?? null, false);
  }

  /** Same persistence, but the text comes from ArticleGeneratorService and is flagged `aiGenerated`. */
  async generateArticle(authorId: string, dto: GenerateArticleDto) {
    const generated = await this.generator.compose(dto);
    return this.persist(authorId, dto.category, generated, null, true);
  }

  private async persist(
    authorId: string,
    category: ArticleCategory,
    content: GeneratedArticle,
    coverImageUrl: string | null,
    aiGenerated: boolean,
  ) {
    const slug = await this.generateUniqueSlug(content.title);
    const article = await this.prisma.article.create({
      data: {
        authorId,
        slug,
        title: content.title,
        excerpt: content.excerpt,
        body: content.body,
        coverImageUrl,
        category,
        readMinutes: this.estimateReadMinutes(content.body),
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
        aiGenerated,
      },
      select: { ...ARTICLE_CARD_SELECT, body: true },
    });

    this.logger.log(
      `Article "${article.title}" published as ${article.slug} by ${authorId}${aiGenerated ? ' (AI-generated)' : ''}`,
    );

    return { ...this.toCard(article), body: article.body };
  }

  /** 200 wpm, floor of 1 — a 40-word note still reads as "1 min". */
  private estimateReadMinutes(body: string): number {
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  }

  /**
   * Lowercased, accent-stripped, hyphenated title, with a numeric suffix on
   * collision (`gestao-de-caixa`, `gestao-de-caixa-2`, ...). The suffix loop
   * queries rather than trusting a cached count, so it stays correct when
   * older articles have been deleted.
   */
  private async generateUniqueSlug(title: string): Promise<string> {
    const base = this.slugify(title) || 'artigo';

    let candidate = base;
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const taken = await this.prisma.article.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!taken) return candidate;
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
  }

  private slugify(title: string): string {
    return title
      .normalize('NFD')
      // Strip the combining accent marks NFD just split off (é -> e + U+0301).
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
  }

  private toCard(article: ArticleCard) {
    return {
      id: article.id,
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      coverImageUrl: article.coverImageUrl,
      category: article.category,
      readMinutes: article.readMinutes,
      authorName: article.author.profile?.name ?? 'Equipe VIBE MATCH',
      authorId: article.authorId,
      aiGenerated: article.aiGenerated,
      publishedAt: article.publishedAt,
      viewCount: article.viewCount,
    };
  }

  /** Stable enum order, so the client's filter bar doesn't reshuffle between requests. */
  private orderCategories(categories: ArticleCategory[]): ArticleCategory[] {
    const present = new Set(categories);
    return Object.values(ArticleCategory).filter((c) => present.has(c));
  }
}
