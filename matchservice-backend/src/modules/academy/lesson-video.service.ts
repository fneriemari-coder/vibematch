import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LazyOpenAI } from '../../common/ai/lazy-openai';
import { S3StorageService } from '../../common/storage/s3-storage.service';

const run = promisify(execFile);

export interface LessonVideoResult {
  moduleId: string;
  title: string;
  videoUrl?: string;
  error?: string;
}

export interface LessonVideoBatchResult {
  /** False when a prerequisite is missing; nothing was attempted. */
  attempted: boolean;
  reason?: string;
  rendered: number;
  failed: number;
  modules: LessonVideoResult[];
}

/** 1280x720 — the player is a fixed 16:9 box, so anything else gets letterboxed. */
const WIDTH = 1280;
const HEIGHT = 720;

/**
 * The narration cap.
 *
 * The speech endpoint rejects input past a few thousand characters, and a
 * lesson script that long is a sign the module should have been split anyway.
 * Cutting at a sentence boundary keeps the audio from ending mid-word.
 */
const MAX_NARRATION_CHARS = 3800;

/** Rendering is CPU-bound and sequential; a batch this size is a few minutes. */
const BATCH_LIMIT = 8;

/** A stuck ffmpeg must not hold a worker forever. */
const FFMPEG_TIMEOUT_MS = 180_000;

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];

// Brand palette, mirrored from the app's design tokens. Hard-coded rather than
// imported because ffmpeg wants 0xRRGGBB and the client wants Dart Colors —
// two representations of the same four values, and neither can consume the
// other's.
const INK = '0x0B2237';
const GOLD = '0xC9A46B';
const CREAM = '0xF5F2EA';

/**
 * Turns a written lesson into a lesson you can watch.
 *
 * Every module already carries `voiceScript` — the narration the course
 * generator writes for it. Nothing ever read that field aloud, so `videoUrl`
 * stayed null and the academy screen showed a dead play button on every
 * lesson. The script was the hard part and it was already done; this is the
 * part that turns it into a file.
 *
 * Deliberately not a talking-head vendor. The narration is read by the speech
 * endpoint of the key this deployment already has, laid over the course's own
 * cover art with the module title set on it, and muxed by ffmpeg. That is a
 * real narrated lesson at a few cents each, with no new supplier, no new
 * contract and no new failure mode — and if a presenter avatar is added later
 * it replaces the video track without touching the queue, the storage layout
 * or the player.
 *
 * Never runs on boot. Covers are cheap and fast so they backfill themselves;
 * a video render is neither, and starting eight of them while the container is
 * still opening its port would trade a working API for a full shelf. This one
 * waits to be asked.
 */
@Injectable()
export class LessonVideoService {
  private readonly logger = new Logger(LessonVideoService.name);
  private readonly openai: LazyOpenAI;
  private readonly speechModel: string;
  private readonly voice: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: S3StorageService,
  ) {
    this.openai = new LazyOpenAI(this.config.get('OPENAI_API_KEY'), this.logger, 'lesson narration');
    this.speechModel = this.config.get('OPENAI_TTS_MODEL') ?? 'gpt-4o-mini-tts';
    this.voice = this.config.get('OPENAI_TTS_VOICE') ?? 'onyx';
  }

  /**
   * ffmpeg is a system binary, not an npm dependency, so a deployment can be
   * perfectly configured and still not be able to render. Checked once —
   * whether it is on PATH does not change while the process runs.
   */
  private ffmpegChecked = false;
  private ffmpegPresent = false;

  private async hasFfmpeg(): Promise<boolean> {
    if (this.ffmpegChecked) return this.ffmpegPresent;
    this.ffmpegChecked = true;
    try {
      await run('ffmpeg', ['-version'], { timeout: 10_000 });
      this.ffmpegPresent = true;
    } catch {
      this.ffmpegPresent = false;
      this.logger.warn('ffmpeg is not on PATH — lesson videos cannot be rendered in this deployment');
    }
    return this.ffmpegPresent;
  }

  async renderMissingVideos(limit = BATCH_LIMIT): Promise<LessonVideoBatchResult> {
    if (!this.openai.isConfigured) {
      return notAttempted('OPENAI_API_KEY is not configured — no narration can be produced');
    }
    if (!this.storage.isConfigured) {
      return notAttempted('AWS S3 is not configured — a rendered lesson would have nowhere to live');
    }
    if (!(await this.hasFfmpeg())) {
      return notAttempted('ffmpeg is not installed in this container — see the Dockerfile');
    }

    const modules = await this.prisma.courseModule.findMany({
      where: { videoUrl: null, NOT: { voiceScript: '' } },
      orderBy: [{ courseId: 'asc' }, { orderIndex: 'asc' }],
      take: limit,
      include: { course: { select: { id: true, title: true } } },
    });

    const results: LessonVideoResult[] = [];
    // Sequential: each render pins a core for its whole duration, and running
    // the batch in parallel on a small container starves the API serving real
    // requests alongside it.
    for (const mod of modules) {
      try {
        const videoUrl = await this.renderModule(mod);
        results.push({ moduleId: mod.id, title: mod.title, videoUrl });
      } catch (error) {
        const message = describe(error);
        this.logger.warn(`Lesson video failed for module ${mod.id} (${mod.title}): ${message}`);
        results.push({ moduleId: mod.id, title: mod.title, error: message });
      }
    }

    const rendered = results.filter((r) => r.videoUrl).length;
    if (rendered > 0) this.logger.log(`Rendered ${rendered} lesson video${rendered === 1 ? '' : 's'}`);

    return { attempted: true, rendered, failed: results.length - rendered, modules: results };
  }

  private async renderModule(mod: {
    id: string;
    title: string;
    voiceScript: string;
    course: { id: string; title: string };
  }): Promise<string> {
    const narration = trimToSentence(mod.voiceScript, MAX_NARRATION_CHARS);
    if (!narration) throw new Error('Module has no narration script to read');

    const speech = await this.openai.audio.speech.create({
      model: this.speechModel,
      voice: this.voice,
      input: narration,
      response_format: 'mp3',
    });
    const audio = Buffer.from(await speech.arrayBuffer());

    // Its own directory so the cleanup at the end cannot reach anything it did
    // not create, even if a render is interrupted halfway.
    const workDir = await mkdtemp(join(tmpdir(), 'lesson-'));
    try {
      const audioPath = join(workDir, 'narration.mp3');
      const titlePath = join(workDir, 'title.txt');
      const outputPath = join(workDir, 'lesson.mp4');

      await writeFile(audioPath, audio);
      await writeFile(titlePath, wrapTitle(mod.title), 'utf8');

      // The course's own cover becomes the backdrop when it exists, so the
      // lesson and the card in the catalogue are visibly the same product.
      const cover = await this.storage.downloadBuffer(`course-covers/${mod.course.id}.png`);
      let backgroundPath: string | null = null;
      if (cover) {
        backgroundPath = join(workDir, 'background.png');
        await writeFile(backgroundPath, cover);
      }

      await run('ffmpeg', this.ffmpegArgs({ backgroundPath, audioPath, titlePath, outputPath }), {
        timeout: FFMPEG_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      });

      const video = await readFile(outputPath);
      const url = await this.storage.uploadBuffer(`lesson-videos/${mod.id}.mp4`, video, 'video/mp4');

      await this.prisma.courseModule.update({ where: { id: mod.id }, data: { videoUrl: url } });
      return url;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private ffmpegArgs({
    backgroundPath,
    audioPath,
    titlePath,
    outputPath,
  }: {
    backgroundPath: string | null;
    audioPath: string;
    titlePath: string;
    outputPath: string;
  }): string[] {
    const input = backgroundPath
      ? ['-loop', '1', '-i', backgroundPath]
      : ['-f', 'lavfi', '-i', `color=c=${INK}:s=${WIDTH}x${HEIGHT}`];

    return [
      '-y',
      ...input,
      '-i',
      audioPath,
      '-vf',
      this.videoFilter(Boolean(backgroundPath), titlePath),
      '-c:v',
      'libx264',
      '-tune',
      'stillimage',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      // The audio decides the length: the still image would otherwise loop
      // forever and ffmpeg would never terminate.
      '-shortest',
      // Puts the moov atom first so the player can start before the whole file
      // has arrived — without it a lesson buffers to 100% before playing.
      '-movflags',
      '+faststart',
      outputPath,
    ];
  }

  private videoFilter(hasBackground: boolean, titlePath: string): string {
    const stages: string[] = [];

    if (hasBackground) {
      // Fill the frame, then crop — never stretch a face or a building.
      stages.push(
        `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
        `crop=${WIDTH}:${HEIGHT}`,
        // Darkens the photograph so cream text stays readable over any cover,
        // including a bright one.
        `drawbox=x=0:y=0:w=${WIDTH}:h=${HEIGHT}:color=${INK}@0.62:t=fill`,
      );
    }

    // The gold rule above the title — the same mark the app draws over a
    // section heading.
    stages.push(`drawbox=x=96:y=300:w=64:h=4:color=${GOLD}@1:t=fill`);

    const font = FONT_CANDIDATES.find((candidate) => existsSync(candidate));
    if (font) {
      // The title goes through a file rather than the filter string: a colon,
      // a quote or a comma in a course title would otherwise be parsed as
      // filter syntax and break the render.
      // `drawtext=` then colon-separated options — the filter name takes an
      // `=`, not a `:`, and getting that wrong parses as a filter called
      // "drawtext" with no arguments and fails the whole graph.
      stages.push(
        'drawtext=' +
        [
          `fontfile=${font}`,
          `textfile=${titlePath}`,
          'fontsize=54',
          `fontcolor=${CREAM}`,
          'x=96',
          'y=340',
          'line_spacing=14',
        ].join(':'),
      );
    } else {
      // A missing font must cost the title, not the lesson.
      this.logger.warn('No usable font found — rendering the lesson without its title card');
    }

    return stages.join(',');
  }
}

/**
 * drawtext does not wrap, so a long title runs off the frame. Broken by words
 * into lines that fit the type size at the left margin.
 */
export function wrapTitle(title: string, maxCharsPerLine = 34, maxLines = 3): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  const wrapped = lines.slice(0, maxLines);
  if (words.join(' ').length > wrapped.join(' ').length && wrapped.length) {
    wrapped[wrapped.length - 1] = `${wrapped[wrapped.length - 1]}…`;
  }
  return wrapped.join('\n');
}

/** Cuts at the last sentence end inside the cap, so narration never stops mid-word. */
export function trimToSentence(script: string, max: number): string {
  const clean = script.trim();
  if (clean.length <= max) return clean;

  const window = clean.slice(0, max);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  return (lastStop > max * 0.5 ? window.slice(0, lastStop + 1) : window).trim();
}

function notAttempted(reason: string): LessonVideoBatchResult {
  return { attempted: false, reason, rendered: 0, failed: 0, modules: [] };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
