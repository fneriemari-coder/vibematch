import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PostStatus, Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

interface GeneratedPost {
  title: string;
  contentText: string;
  hashtags: string[];
  vibeChallenge: string;
  tags: string[];
}

const GENERATED_POST_SCHEMA = {
  name: 'generated_discovery_post',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Attention-grabbing headline about corporate efficiency, automation, or home/property maintenance.' },
      contentText: { type: 'string', description: 'Polished, specific descriptive body — reads like a real practitioner post, not generic marketing copy.' },
      hashtags: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
      vibeChallenge: {
        type: 'string',
        description:
          "A personalized #VibeChallenge call-to-action, e.g. 'Poste seu portfólio de IA usando a ferramenta X para ganhar 100 pontos de K-SCORE'.",
      },
      tags: {
        type: 'array',
        description: '2-3 SCREAMING_SNAKE_CASE marketplace skill tags matching the post topic.',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 3,
      },
    },
    required: ['title', 'contentText', 'hashtags', 'vibeChallenge', 'tags'],
    additionalProperties: false,
  },
} as const;

const BOT_PROFILES = [
  { email: 'bot.vibe.efficiency@matchservice.dev', name: 'Vibe Efficiency Desk', country: 'US' },
  { email: 'bot.vibe.manutencao@matchservice.dev', name: 'Vibe Manutenção BR', country: 'BR' },
  { email: 'bot.vibe.automation@matchservice.dev', name: 'Vibe Automation Lab', country: 'US' },
];

/**
 * "VibeAiOrchestrator" — Agents 1 & 2: autonomous content sourcing +
 * publishing. Runs twice a day, has GPT-4o-mini invent one high-engagement
 * post (structured output, so the shape is always parseable), and attributes
 * it to a rotating system/bot profile so the Discovery Feed never runs dry
 * while organic supply ramps up.
 */
@Injectable()
export class AiPublisherService {
  private readonly logger = new Logger(AiPublisherService.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private botIndex = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  @Cron(CronExpression.EVERY_12_HOURS)
  async publishAutonomousPost(): Promise<void> {
    try {
      const generated = await this.generatePost();
      const botUserId = await this.nextBotProfile();

      const fullBody = `${generated.contentText}\n\n${generated.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}\n\n${generated.vibeChallenge}`;

      await this.prisma.discoveryPost.create({
        data: {
          userId: botUserId,
          title: generated.title,
          contentText: fullBody,
          status: PostStatus.PUBLISHED,
          tags: { create: generated.tags.map((tagName) => ({ tagName })) },
        },
      });

      this.logger.log(`Autonomous post published: "${generated.title}"`);
    } catch (err) {
      this.logger.error(`Autonomous post generation failed: ${(err as Error).message}`);
    }
  }

  private async generatePost(): Promise<GeneratedPost> {
    const completion = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.9,
      response_format: { type: 'json_schema', json_schema: GENERATED_POST_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            'You are the autonomous content desk for VIBE MATCH, a services marketplace Discovery Feed. ' +
            'Invent one realistic, high-engagement post about EITHER corporate efficiency/automation (AI, ' +
            'SaaS, dev, design, video) OR home/property maintenance and local services. Never mention that ' +
            'the post is AI-generated or fictional. Write like a real practitioner sharing a genuine win.',
        },
        { role: 'user', content: 'Generate today\'s post.' },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty completion from OpenAI');
    return JSON.parse(raw) as GeneratedPost;
  }

  /** Round-robins across a small pool of system bot profiles, creating them lazily on first use. */
  private async nextBotProfile(): Promise<string> {
    const spec = BOT_PROFILES[this.botIndex % BOT_PROFILES.length];
    this.botIndex++;

    const user = await this.prisma.user.upsert({
      where: { email: spec.email },
      update: {},
      create: {
        email: spec.email,
        passwordHash: 'unusable-bot-account', // never used for login — bots have no client-facing auth
        role: Role.PROVIDER,
        country: spec.country,
        isBot: true,
        profile: { create: { name: spec.name, bio: 'Automated VIBE MATCH content desk.' } },
      },
    });
    return user.id;
  }
}
