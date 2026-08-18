import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { S3StorageService } from '../src/common/storage/s3-storage.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AiFactoryService } from '../src/modules/academy/ai-factory.service';
import { CourseCoverService } from '../src/modules/academy/course-cover.service';
import { AI_COURSE_TOPICS, ComposedTopic } from '../src/modules/academy/ai-course-composer';

// The Nest ConfigService reads process.env, which nothing has populated when
// this runs outside the app (PrismaClient loads .env for itself only).
dotenv.config();

/**
 * Publishes the four AI-produced courses in the VibeAcademy catalogue.
 *
 *   node dist-seed/seed-ai-courses.js
 *
 * Both paths go through `AiFactoryService`, the same service behind
 * POST /academy/generate-ai-course, so the courses are identical in shape to
 * anything an admin generates through the API — modules, simulated lesson
 * videos, the PDF material pack when object storage is configured, and the
 * `AI_GENERATED` marker tag the client badges on.
 *
 * Where the *content* comes from depends on the environment:
 *
 *  - `OPENAI_API_KEY` present and working → the model writes the scope, via
 *    the `LazyOpenAI` wrapper (never a directly-constructed `OpenAI`, so a
 *    missing key degrades instead of exploding).
 *  - key absent, invalid, rate-limited or the call fails for any reason →
 *    the deterministic composer in `ai-course-composer.ts` supplies a real,
 *    hand-written Portuguese course. Four courses come out either way. There
 *    is no "conteúdo em breve" path.
 *
 * Idempotent: a topic whose title is already in the catalogue is skipped.
 */

const prisma = new PrismaClient();

async function resolveInstructorIds(): Promise<string[]> {
  // "Attributed to the seeded mentor users" — the curated group the Academy
  // already surfaces at GET /academy/mentors.
  const mentors = await prisma.userProfile.findMany({
    where: { isMentor: true },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  if (mentors.length > 0) return mentors.map((m) => m.userId);

  // Fallback so a database seeded without the mentors step still produces a
  // catalogue rather than dying — any real instructor beats no courses.
  const providers = await prisma.user.findMany({
    where: { role: { in: ['PROVIDER', 'BOTH'] }, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 4,
  });
  if (providers.length === 0) {
    throw new Error(
      'Nenhum mentor ou prestador encontrado para atribuir os cursos. Rode `npm run seed:prod` antes deste script.',
    );
  }
  console.warn('Nenhum mentor marcado (isMentor). Atribuindo os cursos aos prestadores mais antigos.');
  return providers.map((p) => p.id);
}

async function publishTopic(
  factory: AiFactoryService,
  topic: ComposedTopic,
  instructorId: string,
  useModel: boolean,
): Promise<{ courseId: string; source: 'openai' | 'composer' }> {
  if (useModel) {
    try {
      const result = await factory.generateCourse(instructorId, {
        // The composed title is the idempotency key, so the model is asked to
        // adopt it; the normalisation below enforces it either way.
        topicHint: `${topic.topicHint} Use exatamente este título: "${topic.title}".`,
      });

      if (result.course.title !== topic.title) {
        await prisma.businessCourse.update({
          where: { id: result.course.id },
          data: { title: topic.title },
        });
        console.warn(`  modelo devolveu outro título; normalizado para "${topic.title}" (chave de idempotência).`);
      }

      return { courseId: result.course.id, source: 'openai' };
    } catch (error) {
      console.warn(
        `  chamada ao modelo falhou (${error instanceof Error ? error.message : error}) — usando o compositor local.`,
      );
    }
  }

  const result = await factory.publishCourseFromScope(instructorId, topic.scope);
  return { courseId: result.course.id, source: 'composer' };
}

async function main() {
  const config = new ConfigService();
  const storage = new S3StorageService(config);
  // AiFactoryService only ever uses PrismaService as a PrismaClient; outside
  // Nest there is no injector, so the concrete client is passed directly.
  // Same three dependencies the seed already holds. Constructing it here
  // rather than letting Nest do it also skips its OnModuleInit cover-backfill
  // — this script publishes the covers for the courses it creates itself.
  const courseCovers = new CourseCoverService(prisma as unknown as PrismaService, config, storage);
  const factory = new AiFactoryService(
    prisma as unknown as PrismaService,
    config,
    storage,
    new EventEmitter2(),
    courseCovers,
  );

  const useModel = Boolean(process.env.OPENAI_API_KEY);
  console.log(
    useModel
      ? 'OPENAI_API_KEY presente — tentando gerar pelo modelo, com o compositor local como reserva.'
      : 'OPENAI_API_KEY ausente — gerando os quatro cursos pelo compositor local determinístico.',
  );

  const instructorIds = await resolveInstructorIds();
  const published: Array<{ title: string; source: string }> = [];
  let skipped = 0;

  for (let i = 0; i < AI_COURSE_TOPICS.length; i++) {
    const topic = AI_COURSE_TOPICS[i];

    const existing = await prisma.businessCourse.findFirst({
      where: { title: topic.title },
      select: { id: true },
    });
    if (existing) {
      console.log(`- "${topic.title}" já existe (${existing.id}) — ignorado.`);
      skipped++;
      continue;
    }

    const instructorId = instructorIds[i % instructorIds.length];
    console.log(`- publicando "${topic.title}"...`);
    const { courseId, source } = await publishTopic(factory, topic, instructorId, useModel);
    console.log(`  ok: ${courseId} (origem: ${source})`);
    published.push({ title: topic.title, source });
  }

  console.log(`\nCursos publicados: ${published.length}. Ignorados por já existirem: ${skipped}.`);
  for (const course of published) {
    console.log(`  • ${course.title}  [${course.source}]`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
