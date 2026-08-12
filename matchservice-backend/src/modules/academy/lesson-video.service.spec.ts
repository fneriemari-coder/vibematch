import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LessonVideoService, trimToSentence, wrapTitle } from './lesson-video.service';

const run = promisify(execFile);

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) } as any;
}

function buildPrisma(modules: any[]) {
  return {
    courseModule: {
      findMany: jest.fn(async ({ take }: any = {}) =>
        modules.filter((m) => m.videoUrl == null).slice(0, take ?? modules.length),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const mod = modules.find((m) => m.id === where.id);
        Object.assign(mod, data);
        return mod;
      }),
    },
  } as any;
}

function buildStorage({ configured = true, cover = null as Buffer | null } = {}) {
  return {
    isConfigured: configured,
    downloadBuffer: jest.fn(async () => cover),
    uploadBuffer: jest.fn(async (key: string) => `https://cdn.test/${key}`),
  } as any;
}

function lessonModule(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Módulo ${id}`,
    voiceScript: 'Uma frase curta de narração para a aula.',
    videoUrl: null,
    orderIndex: 1,
    courseId: 'course-1',
    course: { id: 'course-1', title: 'Curso' },
    ...overrides,
  };
}

/** Stands in for the speech endpoint; the bytes are a real MP3 built by ffmpeg. */
function stubSpeech(service: LessonVideoService, mp3: Buffer) {
  Object.defineProperty(service as any, 'openai', {
    value: {
      isConfigured: true,
      audio: {
        speech: {
          create: jest.fn(async () => ({ arrayBuffer: async () => mp3 })),
        },
      },
    },
    configurable: true,
  });
}

describe('wrapTitle', () => {
  it('keeps a short title on one line', () => {
    expect(wrapTitle('Fluxo de caixa')).toBe('Fluxo de caixa');
  });

  it('breaks a long title on word boundaries instead of running off the frame', () => {
    const wrapped = wrapTitle('Como precificar serviço recorrente sem perder margem no primeiro ano');
    expect(wrapped.split('\n').length).toBeGreaterThan(1);
    expect(wrapped.split('\n').every((line) => line.length <= 35)).toBe(true);
    expect(wrapped).not.toContain('  ');
  });

  it('marks a title it had to cut, so a truncated card does not read as the whole title', () => {
    const wrapped = wrapTitle(
      'Um título deliberadamente longo que não cabe em três linhas de jeito nenhum e que segue ' +
        'adiante falando de margem, precificação, contratos recorrentes e mais uma porção de coisas',
    );
    expect(wrapped.split('\n')).toHaveLength(3);
    expect(wrapped.endsWith('…')).toBe(true);
  });
});

describe('trimToSentence', () => {
  it('leaves a script that already fits alone', () => {
    expect(trimToSentence('Curto.', 100)).toBe('Curto.');
  });

  it('cuts at a sentence end rather than mid-word', () => {
    const script = `${'Primeira frase completa. '.repeat(8)}Uma frase que sera cortada no meio das palavras`;
    const trimmed = trimToSentence(script, 120);
    expect(trimmed.length).toBeLessThanOrEqual(120);
    expect(trimmed.endsWith('.')).toBe(true);
  });

  it('still cuts when there is no sentence break to fall back on', () => {
    const trimmed = trimToSentence('palavra '.repeat(200), 50);
    expect(trimmed.length).toBeLessThanOrEqual(50);
  });
});

describe('LessonVideoService', () => {
  it('does not attempt a batch without a key, and leaves videoUrl null', async () => {
    const modules = [lessonModule('m1')];
    const service = new LessonVideoService(buildPrisma(modules), buildConfig(), buildStorage());

    const result = await service.renderMissingVideos();

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain('OPENAI_API_KEY');
    expect(modules[0].videoUrl).toBeNull();
  });

  it('does not attempt a batch with nowhere to store the render', async () => {
    const modules = [lessonModule('m1')];
    const service = new LessonVideoService(
      buildPrisma(modules),
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
      buildStorage({ configured: false }),
    );

    const result = await service.renderMissingVideos();

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain('S3');
  });

  it('does not attempt a batch when ffmpeg is missing from the container', async () => {
    const modules = [lessonModule('m1')];
    const service = new LessonVideoService(
      buildPrisma(modules),
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
      buildStorage(),
    );
    Object.defineProperty(service as any, 'ffmpegChecked', { value: true, writable: true });
    Object.defineProperty(service as any, 'ffmpegPresent', { value: false, writable: true });

    const result = await service.renderMissingVideos();

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain('ffmpeg');
  });
});

/**
 * The real thing: narration bytes in, a playable MP4 out.
 *
 * ffmpeg is the part of this feature most likely to be wrong in a way types
 * cannot catch — a filter that parses but renders nothing, an argument order
 * that silently drops the audio — so the filter graph is exercised for real and
 * the output is probed. Skipped where ffmpeg is absent rather than failing the
 * suite, since it is a system binary and not every machine running these tests
 * has one.
 */
const describeIfFfmpeg = hasFfmpegSync() ? describe : describe.skip;

describeIfFfmpeg('LessonVideoService — real render', () => {
  let workDir: string;
  let narration: Buffer;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lesson-spec-'));
    const audioPath = join(workDir, 'narration.mp3');
    // Four seconds of tone standing in for four seconds of speech.
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4',
      '-c:a', 'libmp3lame', audioPath,
    ]);
    narration = await readFile(audioPath);
  }, 60_000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('renders a playable 720p lesson and stores it against the module', async () => {
    const modules = [lessonModule('m1', { title: 'Precificação de serviço recorrente: margem real' })];
    const storage = buildStorage();
    const service = new LessonVideoService(
      buildPrisma(modules),
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
      storage,
    );
    stubSpeech(service, narration);

    const result = await service.renderMissingVideos();

    expect(result.attempted).toBe(true);
    expect(result.rendered).toBe(1);
    expect(result.failed).toBe(0);
    expect(modules[0].videoUrl).toBe('https://cdn.test/lesson-videos/m1.mp4');

    const [key, bytes, contentType] = storage.uploadBuffer.mock.calls[0];
    expect(key).toBe('lesson-videos/m1.mp4');
    expect(contentType).toBe('video/mp4');

    // Probe what was actually uploaded — the assertion that matters is that
    // this is a real file a player can open, not that a function returned.
    const probePath = join(workDir, 'uploaded.mp4');
    await writeFile(probePath, bytes);
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,width,height',
      '-show_entries', 'format=duration',
      '-of', 'json', probePath,
    ]);
    const probe = JSON.parse(stdout);
    const video = probe.streams.find((s: any) => s.codec_name === 'h264');
    const audio = probe.streams.find((s: any) => s.codec_name === 'aac');

    expect(video).toMatchObject({ width: 1280, height: 720 });
    // The lesson must carry the narration; a silent video is the failure this
    // catches, and it is invisible to every other check.
    expect(audio).toBeDefined();
    // -shortest ends the still image with the audio rather than looping forever.
    expect(Number(probe.format.duration)).toBeCloseTo(4, 0);
  }, 120_000);

  it('survives a title full of filter-syntax characters', async () => {
    // A colon, a comma, a quote and a backslash would each break drawtext if
    // the title were interpolated into the filter string instead of passed
    // through a file.
    const modules = [lessonModule('m2', { title: `Margem: custo, preço e "lucro" \\ real` })];
    const service = new LessonVideoService(
      buildPrisma(modules),
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
      buildStorage(),
    );
    stubSpeech(service, narration);

    const result = await service.renderMissingVideos();

    expect(result.failed).toBe(0);
    expect(result.rendered).toBe(1);
  }, 120_000);

  it('uses the course cover as the backdrop when one exists', async () => {
    const coverPath = join(workDir, 'cover.png');
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x884422:s=1920x1080', '-frames:v', '1', coverPath]);
    const cover = await readFile(coverPath);

    const modules = [lessonModule('m3')];
    const storage = buildStorage({ cover });
    const service = new LessonVideoService(
      buildPrisma(modules),
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
      storage,
    );
    stubSpeech(service, narration);

    const result = await service.renderMissingVideos();

    expect(storage.downloadBuffer).toHaveBeenCalledWith('course-covers/course-1.png');
    expect(result.rendered).toBe(1);
  }, 120_000);

  it('reports the module that failed and keeps rendering the rest', async () => {
    const modules = [lessonModule('m4'), lessonModule('m5')];
    const service = new LessonVideoService(
      buildPrisma(modules),
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
      buildStorage(),
    );
    let call = 0;
    Object.defineProperty(service as any, 'openai', {
      value: {
        isConfigured: true,
        audio: {
          speech: {
            create: jest.fn(async () => {
              call += 1;
              if (call === 1) throw new Error('speech quota exceeded');
              return { arrayBuffer: async () => narration };
            }),
          },
        },
      },
      configurable: true,
    });

    const result = await service.renderMissingVideos();

    expect(result.failed).toBe(1);
    expect(result.rendered).toBe(1);
    expect(result.modules[0].error).toBe('speech quota exceeded');
    expect(modules[0].videoUrl).toBeNull();
    expect(modules[1].videoUrl).toBe('https://cdn.test/lesson-videos/m5.mp4');
  }, 120_000);
});

function hasFfmpegSync(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('node:child_process').execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
