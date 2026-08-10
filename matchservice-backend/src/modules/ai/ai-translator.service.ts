import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { FeedMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiTranslateDto } from './dto/ai-translate.dto';

interface IntentTranslation {
  interpretedNeeds: string[];
  suggestedMode: FeedMode;
}

const INTENT_JSON_SCHEMA = {
  name: 'intent_translation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      interpretedNeeds: {
        type: 'array',
        description: 'Exactly 3 precise, market-standard technical skill tags (SCREAMING_SNAKE_CASE) that address the user\'s described pain point.',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 3,
      },
      suggestedMode: {
        type: 'string',
        enum: ['CLOUD', 'LOCAL'],
        description: 'CLOUD for remote/digital work (marketing, automation, design, dev). LOCAL for on-site/physical work near the given coordinates.',
      },
    },
    required: ['interpretedNeeds', 'suggestedMode'],
    additionalProperties: false,
  },
} as const;

/**
 * "AI Needs Translator" — turns a confusing, plain-language pain point
 * ("meu Instagram não vende", "preciso trocar o piso da sala") into 3 exact
 * marketplace skill tags plus a CLOUD/LOCAL routing hint, then fans out to
 * fetch matching DiscoveryPost content and swipeable UserProfiles in parallel.
 */
@Injectable()
export class AiTranslatorService {
  private readonly logger = new Logger(AiTranslatorService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  async translate(userId: string, dto: AiTranslateDto) {
    const intent = await this.interpretIntent(dto.rawInput);

    const [posts, profiles] = await Promise.all([
      this.findRelevantPosts(intent.interpretedNeeds),
      this.findRelevantProfiles(intent.interpretedNeeds, intent.suggestedMode, dto.lat, dto.lng),
    ]);

    await this.prisma.aIProjectSuggestion.create({
      data: {
        userId,
        rawInput: dto.rawInput,
        interpretedNeeds: intent.interpretedNeeds,
        suggestedMode: intent.suggestedMode,
      },
    });

    return {
      interpretedNeeds: intent.interpretedNeeds,
      suggestedMode: intent.suggestedMode,
      posts,
      profiles,
    };
  }

  private async interpretIntent(rawInput: string): Promise<IntentTranslation> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: INTENT_JSON_SCHEMA },
        messages: [
          {
            role: 'system',
            content:
              'You are the intent-translation engine for MatchService, a services marketplace. ' +
              'A user describes a confusing business pain point in natural language (PT-BR or EN). ' +
              'Translate it into exactly 3 precise, hireable, market-standard technical skill tags ' +
              '(e.g. UI_UX, MAKE_AUTOMATION, LOCAL_SEO, VIDEO_EDITING, AI_AUTOMATION, FLOOR_INSTALLATION, ' +
              'PLUMBING, B2B_NETWORKING) and decide whether the work is best sourced globally (CLOUD) or ' +
              'from a provider near the user (LOCAL — physical/on-site work).',
          },
          { role: 'user', content: rawInput },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) throw new Error('Empty completion');
      const parsed = JSON.parse(raw) as IntentTranslation;
      return parsed;
    } catch (err) {
      this.logger.warn(`Intent translation failed, falling back to keyword heuristic: ${(err as Error).message}`);
      return { interpretedNeeds: ['GENERAL_SERVICES', 'CONSULTING', 'CLOUD'], suggestedMode: FeedMode.CLOUD };
    }
  }

  private async findRelevantPosts(tags: string[], limit = 10) {
    return this.prisma.discoveryPost.findMany({
      where: { tags: { some: { tagName: { in: tags } } } },
      orderBy: [{ likesCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { tags: true, user: { select: { id: true, profile: { select: { name: true } } } } },
    });
  }

  private async findRelevantProfiles(tags: string[], mode: FeedMode, lat?: number, lng?: number, limit = 20) {
    if (mode === FeedMode.LOCAL && lat !== undefined && lng !== undefined) {
      const radiusMeters = 25_000;
      return this.prisma.$queryRaw(Prisma.sql`
        SELECT up.user_id AS "userId", up.name AS "name", up.skills AS "skills",
               ST_Distance(
                 ST_MakePoint(up.longitude, up.latitude)::geography,
                 ST_MakePoint(${lng}, ${lat})::geography
               ) AS "distanceMeters"
        FROM user_profiles up
        INNER JOIN users u ON u.id = up.user_id
        WHERE u.role IN ('PROVIDER', 'BOTH')
          AND up.latitude IS NOT NULL AND up.longitude IS NOT NULL
          AND up.skills && ARRAY[${Prisma.join(tags)}]::text[]
          AND ST_DWithin(
            ST_MakePoint(up.longitude, up.latitude)::geography,
            ST_MakePoint(${lng}, ${lat})::geography,
            ${radiusMeters}
          )
        ORDER BY "distanceMeters" ASC
        LIMIT ${limit};
      `);
    }

    return this.prisma.userProfile.findMany({
      where: {
        skills: { hasSome: tags },
        user: { role: { in: ['PROVIDER', 'BOTH'] } },
      },
      orderBy: { averageRating: 'desc' },
      take: limit,
    });
  }
}
