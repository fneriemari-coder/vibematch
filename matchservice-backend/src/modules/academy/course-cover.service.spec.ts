import { CourseCoverService } from './course-cover.service';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) } as any;
}

function buildPrisma(courses: any[]) {
  return {
    __courses: courses,
    businessCourse: {
      count: jest.fn(async ({ where }: any = {}) => {
        if (where?.NOT?.mediaPreviewUrl === null) {
          return courses.filter((c) => c.mediaPreviewUrl != null).length;
        }
        if (where?.mediaPreviewUrl === null) {
          return courses.filter((c) => c.mediaPreviewUrl == null).length;
        }
        return courses.length;
      }),
      findMany: jest.fn(async ({ take }: any = {}) =>
        courses.filter((c) => c.mediaPreviewUrl == null).slice(0, take ?? courses.length),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const course = courses.find((c) => c.id === where.id);
        Object.assign(course, data);
        return course;
      }),
    },
  } as any;
}

function buildStorage({ configured = true } = {}) {
  return {
    isConfigured: configured,
    uploadBuffer: jest.fn(async (key: string) => `https://cdn.test/${key}`),
  } as any;
}

function course(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Curso ${id}`,
    skillsTaught: ['CONTROLLER'],
    mediaPreviewUrl: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Stands in for the image endpoint, one base64 PNG per call. */
function stubImages(service: CourseCoverService, impl: () => Promise<any>) {
  Object.defineProperty(service as any, 'openai', {
    value: { isConfigured: true, images: { generate: jest.fn(impl) } },
    configurable: true,
  });
}

const ONE_PIXEL_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

function build(courses: any[], { storage = buildStorage() } = {}) {
  const prisma = buildPrisma(courses);
  const service = new CourseCoverService(prisma, buildConfig({ OPENAI_API_KEY: 'sk-test' }), storage);
  return { service, prisma, storage };
}

describe('CourseCoverService', () => {
  it('does not attempt a run when the image key is missing, so courses keep their drawn covers', async () => {
    const courses = [course('c1')];
    const prisma = buildPrisma(courses);
    const service = new CourseCoverService(prisma, buildConfig(), buildStorage());

    const result = await service.backfillMissingCovers();

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain('OPENAI_API_KEY');
    expect(prisma.businessCourse.findMany).not.toHaveBeenCalled();
    expect(courses[0].mediaPreviewUrl).toBeNull();
  });

  it('does not attempt a run when there is nowhere to store the bytes', async () => {
    const courses = [course('c1')];
    const { service, prisma } = build(courses, { storage: buildStorage({ configured: false }) });

    const result = await service.backfillMissingCovers();

    expect(result.attempted).toBe(false);
    expect(result.reason).toContain('S3');
    expect(prisma.businessCourse.findMany).not.toHaveBeenCalled();
  });

  it('uploads the generated image and persists its URL on the course', async () => {
    const courses = [course('c1')];
    const { service, storage } = build(courses);
    stubImages(service, async () => ({ data: [{ b64_json: ONE_PIXEL_PNG }] }));

    const result = await service.backfillMissingCovers();

    expect(result.generated).toBe(1);
    expect(result.failed).toBe(0);
    expect(storage.uploadBuffer).toHaveBeenCalledWith(
      'course-covers/c1.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(courses[0].mediaPreviewUrl).toBe('https://cdn.test/course-covers/c1.png');
  });

  it('keeps going when one course fails, and reports which one', async () => {
    const courses = [course('c1'), course('c2')];
    const { service } = build(courses);
    let call = 0;
    stubImages(service, async () => {
      call += 1;
      if (call === 1) throw new Error('rate limited');
      return { data: [{ b64_json: ONE_PIXEL_PNG }] };
    });

    const result = await service.backfillMissingCovers();

    expect(result.generated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.courses[0].error).toBe('rate limited');
    expect(courses[0].mediaPreviewUrl).toBeNull();
    expect(courses[1].mediaPreviewUrl).toBe('https://cdn.test/course-covers/c2.png');
  });

  it('treats an empty image response as a failure rather than storing nothing', async () => {
    const courses = [course('c1')];
    const { service, storage } = build(courses);
    stubImages(service, async () => ({ data: [] }));

    const result = await service.backfillMissingCovers();

    expect(result.failed).toBe(1);
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(courses[0].mediaPreviewUrl).toBeNull();
  });

  it('respects the batch limit so a boot-time run cannot bill for the whole catalogue', async () => {
    const courses = Array.from({ length: 5 }, (_, i) => course(`c${i}`));
    const { service } = build(courses);
    stubImages(service, async () => ({ data: [{ b64_json: ONE_PIXEL_PNG }] }));

    const result = await service.backfillMissingCovers(2);

    expect(result.generated).toBe(2);
    expect(courses.filter((c) => c.mediaPreviewUrl == null)).toHaveLength(3);
  });

  it('leaves an already-covered shelf alone on boot', async () => {
    const courses = [course('c1', { mediaPreviewUrl: 'https://cdn.test/existing.png' }), course('c2')];
    const { service, prisma } = build(courses);
    stubImages(service, async () => ({ data: [{ b64_json: ONE_PIXEL_PNG }] }));

    await service.onModuleInit();

    expect(prisma.businessCourse.findMany).not.toHaveBeenCalled();
  });
});
