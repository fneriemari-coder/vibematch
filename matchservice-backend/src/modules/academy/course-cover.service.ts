import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessCourse } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LazyOpenAI } from '../../common/ai/lazy-openai';
import { S3StorageService } from '../../common/storage/s3-storage.service';

/** What one backfill run did, per course — what POST /admin/courses/covers returns. */
export interface CoverGenerationResult {
  courseId: string;
  title: string;
  coverUrl?: string;
  error?: string;
}

export interface CoverBackfillResult {
  /** False when OPENAI_API_KEY or the AWS_* set is missing; nothing was attempted. */
  attempted: boolean;
  reason?: string;
  generated: number;
  failed: number;
  courses: CoverGenerationResult[];
}

/**
 * How many covers one run will generate.
 *
 * Image generation is the most expensive call in this codebase by an order of
 * magnitude, and a boot-time backfill is exactly the place where an unbounded
 * loop turns a redeploy into a bill. A dozen covers fills the shelf the user
 * actually browses; the rest arrive when an operator asks for them.
 */
const BACKFILL_LIMIT = 12;

/**
 * Cover art for the training catalogue.
 *
 * The complaint was that the courses shelf had no photography — every card
 * fell through to the drawn cover the design system paints from the title's
 * hash. That fallback is deliberate and stays: it never fails to load, it is
 * on-brand, and two courses never look alike. But it is scaffolding, and a
 * catalogue meant to sit beside G4's reads as unfinished without real imagery.
 *
 * So this fills `mediaPreviewUrl`, which the client already renders in
 * preference to the drawn cover — no client change was needed, the field was
 * simply never populated by anything.
 *
 * Degradation is the whole design here. Without an OpenAI key, or without S3
 * to put the bytes in, nothing is attempted and every card keeps its drawn
 * cover. A course whose generation fails keeps its drawn cover too. There is
 * no state in which the shelf renders empty frames.
 */
@Injectable()
export class CourseCoverService implements OnModuleInit {
  private readonly logger = new Logger(CourseCoverService.name);
  private readonly openai: LazyOpenAI;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: S3StorageService,
  ) {
    this.openai = new LazyOpenAI(this.config.get('OPENAI_API_KEY'), this.logger, 'course cover art');
    this.model = this.config.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-1';
  }

  /**
   * Fills the shelf on the first boot that finds it bare.
   *
   * Same shape as the Radar's first-run ingestion, and for the same reason:
   * the catalogue being visibly empty on a fresh deployment is a product
   * problem, not an ops problem, and it should not need a curl to fix. The
   * guard is "no course has a cover yet" rather than "some course lacks one",
   * so this runs once over a new database and then never again — a redeploy
   * does not re-bill for art that already exists.
   */
  async onModuleInit(): Promise<void> {
    if (!this.isAvailable) return;

    const withCover = await this.prisma.businessCourse.count({
      where: { NOT: { mediaPreviewUrl: null } },
    });
    if (withCover > 0) return;

    const pending = await this.prisma.businessCourse.count({ where: { mediaPreviewUrl: null } });
    if (pending === 0) return;

    this.logger.log(`No course has cover art yet — generating up to ${BACKFILL_LIMIT} in the background`);

    // Deliberately not awaited: art for the catalogue is not worth delaying
    // the port opening for, and a slow image API must not stall a deploy.
    void this.backfillMissingCovers()
      .then((result) => {
        if (result.generated === 0) {
          this.logger.warn(
            'First-run cover generation produced nothing. Check per-course errors via ' +
              'POST /admin/courses/covers — courses keep their generated covers meanwhile.',
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`First-run cover generation failed: ${describe(error)}`);
      });
  }

  /** Both halves are needed: a generated image with nowhere to live is wasted spend. */
  get isAvailable(): boolean {
    return this.openai.isConfigured && this.storage.isConfigured;
  }

  async backfillMissingCovers(limit = BACKFILL_LIMIT): Promise<CoverBackfillResult> {
    if (!this.openai.isConfigured) {
      return emptyRun('OPENAI_API_KEY is not configured — courses keep their generated covers');
    }
    if (!this.storage.isConfigured) {
      return emptyRun('AWS S3 is not configured — courses keep their generated covers');
    }

    const courses = await this.prisma.businessCourse.findMany({
      where: { mediaPreviewUrl: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const results: CoverGenerationResult[] = [];
    // Sequential on purpose. Image endpoints rate-limit hard, and a dozen
    // parallel requests trade a slow backfill for a failed one.
    for (const course of courses) {
      try {
        const coverUrl = await this.generateCoverFor(course);
        results.push({ courseId: course.id, title: course.title, coverUrl });
      } catch (error) {
        const message = describe(error);
        this.logger.warn(`Cover generation failed for course ${course.id} (${course.title}): ${message}`);
        results.push({ courseId: course.id, title: course.title, error: message });
      }
    }

    const generated = results.filter((r) => r.coverUrl).length;
    if (generated > 0) {
      this.logger.log(`Generated ${generated} course cover${generated === 1 ? '' : 's'}`);
    }

    return {
      attempted: true,
      generated,
      failed: results.length - generated,
      courses: results,
    };
  }

  /** Generates, stores and persists one course's cover, returning its public URL. */
  async generateCoverFor(course: BusinessCourse): Promise<string> {
    const response = await this.openai.images.generate({
      model: this.model,
      prompt: buildPrompt(course),
      size: '1536x1024',
      quality: 'medium',
      n: 1,
    });

    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error('Image API returned no image data');

    const bytes = Buffer.from(encoded, 'base64');
    const url = await this.storage.uploadBuffer(
      `course-covers/${course.id}.png`,
      bytes,
      'image/png',
    );

    await this.prisma.businessCourse.update({
      where: { id: course.id },
      data: { mediaPreviewUrl: url },
    });

    return url;
  }
}

/**
 * The art direction, held in one place so every cover belongs to the same
 * catalogue rather than looking like a dozen unrelated stock buys.
 *
 * Two constraints are doing most of the work. No lettering: image models
 * garble text, and a cover with mangled words on it looks broken in a way an
 * abstract one never does — the title is drawn by the client over the image
 * anyway. And no stock-photo clichés: handshakes and rising arrows are exactly
 * the register this platform is trying not to be read in.
 */
function buildPrompt(course: BusinessCourse): string {
  const subject = course.skillsTaught.length
    ? `${course.title} — a matéria trata de ${course.skillsTaught.slice(0, 4).join(', ')}`
    : course.title;

  return [
    'Editorial cover photograph for an executive business course.',
    `Subject: ${subject}.`,
    'Style: cinematic, low-key, shot on a full-frame camera with a wide aperture;',
    'deep navy blue shadows with warm gold rim light, a single restrained accent.',
    'Composition: wide landscape, generous negative space in the upper left where a',
    'title will be typeset, the subject weighted to the right.',
    'Real environments and real materials — architecture, workshop, studio, trading floor,',
    'machinery, documents on a desk — not people posing for the camera.',
    'Absolutely no text, letters, numbers, logos, watermarks or user-interface elements.',
    'Avoid stock-photo clichés: no handshakes, no rising arrows, no glowing circuit-board',
    'overlays, no suited figures pointing at charts.',
  ].join(' ');
}

function emptyRun(reason: string): CoverBackfillResult {
  return { attempted: false, reason, generated: 0, failed: 0, courses: [] };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
