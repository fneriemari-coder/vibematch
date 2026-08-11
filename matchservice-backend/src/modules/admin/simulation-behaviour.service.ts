import { Injectable, Logger } from '@nestjs/common';
import { PostStatus, SwipeDirection } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SwipesService } from '../swipes/swipes.service';
import { TranslationService } from '../chat/translation.service';
import { composeChatReply, composeFeedPost } from './simulation-content';
import { SIMULATED_EMAIL_DOMAIN, deterministicUnitFor, parseSimulatedIndex } from './simulation.core';

/** Share of incoming likes a simulated professional accepts. Chosen to look like a marketplace, not a lottery. */
const RECIPROCATION_RATE = 0.65;

const DAY_MS = 24 * 60 * 60 * 1000;

interface SimulatedActor {
  userId: string;
  email: string;
  index: number;
  country: string;
}

/**
 * Makes the simulated population *behave*, which is what a static roster
 * cannot do: a deck full of people who never swipe back produces zero
 * matches, so the owner can swipe all day and never reach the match → chat →
 * deal flow that is the actual product.
 *
 * Three independent actions, each idempotent and each safe to run repeatedly:
 * reciprocal swiping, chat replies, and feed activity. All of them are driven
 * off the reserved `@simulado.vibematch.dev` domain, so nothing here can ever
 * act on behalf of a real account.
 */
@Injectable()
export class SimulationBehaviourService {
  private readonly logger = new Logger(SimulationBehaviourService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly swipesService: SwipesService,
    private readonly translationService: TranslationService,
  ) {}

  // -------------------------------------------------------------------
  // Reciprocal swiping
  // -------------------------------------------------------------------

  /**
   * Answers every unanswered right-swipe a real user has made on a simulated
   * professional.
   *
   * Goes through `SwipesService.swipe` rather than writing rows directly:
   * that method owns the double opt-in check and the `Match` upsert, and
   * short-circuiting it would produce matches the real code path would never
   * create — matches that then behave differently from organic ones.
   */
  async reciprocatePendingSwipes() {
    const actors = await this.loadActors();
    if (actors.size === 0) return this.emptyReciprocation();

    const incoming = await this.prisma.swipe.findMany({
      where: {
        swipedId: { in: [...actors.keys()] },
        direction: SwipeDirection.LIKE,
        // Only answer real people. Two bots liking each other adds noise to
        // the owner's inbox and proves nothing.
        swiper: { email: { not: { endsWith: `@${SIMULATED_EMAIL_DOMAIN}` } } },
      },
      select: { swiperId: true, swipedId: true, mode: true },
      orderBy: { createdAt: 'asc' },
    });

    let liked = 0;
    let passed = 0;
    let matchesCreated = 0;
    let alreadyAnswered = 0;

    for (const swipe of incoming) {
      const existing = await this.prisma.swipe.findUnique({
        where: {
          swiperId_swipedId_mode: {
            swiperId: swipe.swipedId,
            swipedId: swipe.swiperId,
            mode: swipe.mode,
          },
        },
        select: { id: true },
      });
      if (existing) {
        alreadyAnswered++;
        continue;
      }

      // Deterministic per pair+mode: the same two people always resolve the
      // same way, so a demo can be replayed and a report reproduced.
      const accepts = deterministicUnitFor(swipe.swipedId, swipe.swiperId, swipe.mode) < RECIPROCATION_RATE;
      const direction = accepts ? SwipeDirection.LIKE : SwipeDirection.DISLIKE;

      const result = await this.swipesService.swipe(swipe.swipedId, {
        swipedId: swipe.swiperId,
        direction,
        mode: swipe.mode,
      });

      if (accepts) liked++;
      else passed++;
      if (result.match) matchesCreated++;
    }

    this.logger.log(
      `Reciprocation: ${incoming.length} incoming likes, ${liked} accepted, ${passed} passed, ` +
        `${matchesCreated} matches created, ${alreadyAnswered} already answered.`,
    );

    return {
      incomingLikes: incoming.length,
      liked,
      passed,
      matchesCreated,
      alreadyAnswered,
      acceptanceRate: RECIPROCATION_RATE,
    };
  }

  // -------------------------------------------------------------------
  // Chat replies
  // -------------------------------------------------------------------

  /**
   * Replies in every conversation where a real user spoke last and a
   * simulated professional has not answered.
   *
   * Message rows are written with the same fields the WebSocket gateway
   * writes (`sourceLang` / `targetLang` / `translatedContent`, resolved
   * through `TranslationService`), so a bot message is indistinguishable in
   * shape from a human one and the chat history renders identically.
   */
  async replyToPendingChats() {
    const actors = await this.loadActors();
    if (actors.size === 0) return { conversationsChecked: 0, repliesSent: 0 };

    const actorIds = [...actors.keys()];
    const matches = await this.prisma.match.findMany({
      where: { OR: [{ userOneId: { in: actorIds } }, { userTwoId: { in: actorIds } }] },
      include: {
        userOne: { select: { id: true, country: true } },
        userTwo: { select: { id: true, country: true } },
        chatMessages: { orderBy: { createdAt: 'asc' }, select: { senderId: true } },
      },
    });

    let repliesSent = 0;

    for (const match of matches) {
      const bot = actors.get(match.userOneId) ?? actors.get(match.userTwoId);
      if (!bot) continue;

      const counterpart = match.userOneId === bot.userId ? match.userTwo : match.userOne;
      // Never talk to another bot — a conversation between two simulated
      // users is theatre with no audience.
      if (actors.has(counterpart.id)) continue;

      const messages = match.chatMessages;
      const last = messages[messages.length - 1];
      // Nothing to answer: the conversation is empty, or the bot already had
      // the last word.
      if (!last || last.senderId === bot.userId) continue;

      const turn = messages.filter((m) => m.senderId === bot.userId).length;
      const content = composeChatReply(bot.index, match.id, turn);

      await this.persistMessage(match.id, bot.userId, bot.country, counterpart.country, content);
      repliesSent++;
    }

    this.logger.log(`Chat bots: ${matches.length} conversations checked, ${repliesSent} replies sent.`);
    return { conversationsChecked: matches.length, repliesSent };
  }

  /**
   * Writes a chat message exactly as `ChatGateway.sendMessage` does. Kept in
   * one place so the bot path and the demo journey can't drift from the
   * gateway's message shape.
   */
  async persistMessage(
    matchId: string,
    senderId: string,
    senderCountry: string,
    recipientCountry: string,
    content: string,
    createdAt?: Date,
  ) {
    const sourceLang = TranslationService.languageForCountry(senderCountry);
    const targetLang = TranslationService.languageForCountry(recipientCountry);
    const translatedContent = await this.translationService.translate(content, sourceLang, targetLang);

    return this.prisma.chatMessage.create({
      data: {
        matchId,
        senderId,
        content,
        translatedContent,
        sourceLang,
        targetLang,
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }

  // -------------------------------------------------------------------
  // Feed activity
  // -------------------------------------------------------------------

  /**
   * Publishes `count` Discovery Feed posts authored by simulated professionals.
   *
   * Created `PUBLISHED` directly: these are system-authored, like
   * `ai-publisher.service.ts`'s posts, and the moderation gate in
   * `ai-moderator.service.ts` exists for user-submitted content. Running our
   * own seed material through it would cost OpenAI calls to approve text we
   * wrote ourselves.
   */
  async publishFeedPosts(count: number) {
    const actors = await this.loadActors();
    if (actors.size === 0) return { created: 0, skipped: 0 };

    const authors = [...actors.values()];
    const now = Date.now();
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < count; i++) {
      const author = authors[i % authors.length];
      const slot = Math.floor(i / authors.length);
      const post = composeFeedPost(author.index, slot);

      // Idempotent: the same author never gets the same post twice, so
      // re-running the endpoint tops the feed up instead of duplicating it.
      const existing = await this.prisma.discoveryPost.findFirst({
        where: { userId: author.userId, title: post.title },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // Deterministic engagement and recency, so the feed has a believable
      // spread of hot and quiet posts instead of a uniform block.
      const seed = deterministicUnitFor(author.userId, post.title);
      const daysAgo = Math.floor(seed * 14);
      const likesCount = 12 + Math.floor(seed * 240);
      const viewsCount = likesCount * (6 + Math.floor(seed * 9));

      await this.prisma.discoveryPost.create({
        data: {
          userId: author.userId,
          title: post.title,
          contentText: post.contentText,
          status: PostStatus.PUBLISHED,
          likesCount,
          viewsCount,
          createdAt: new Date(now - daysAgo * DAY_MS - Math.floor(seed * DAY_MS)),
          tags: { create: post.tags.map((tagName) => ({ tagName })) },
        },
      });
      created++;
    }

    this.logger.log(`Feed bots: ${created} posts published, ${skipped} already existed.`);
    return { created, skipped };
  }

  // -------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------

  /**
   * Every simulated account, keyed by user id, with its generation index
   * recovered from the e-mail so replies and posts can speak in that
   * professional's actual specialty.
   */
  private async loadActors(): Promise<Map<string, SimulatedActor>> {
    const users = await this.prisma.user.findMany({
      where: { email: { endsWith: `@${SIMULATED_EMAIL_DOMAIN}` }, deletedAt: null },
      select: { id: true, email: true, country: true },
      orderBy: { email: 'asc' },
    });

    const actors = new Map<string, SimulatedActor>();
    for (const user of users) {
      const index = parseSimulatedIndex(user.email);
      if (index === null) continue;
      actors.set(user.id, { userId: user.id, email: user.email, index, country: user.country });
    }
    return actors;
  }

  private emptyReciprocation() {
    return {
      incomingLikes: 0,
      liked: 0,
      passed: 0,
      matchesCreated: 0,
      alreadyAnswered: 0,
      acceptanceRate: RECIPROCATION_RATE,
    };
  }
}
