import { ForbiddenException } from '@nestjs/common';
import { CertificateService } from './certificate.service';

function buildConfig(overrides: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

const QUESTIONS = Array.from({ length: 5 }, (_, i) => ({
  question: `Q${i}`,
  options: ['a', 'b', 'c', 'd'],
  correctAnswerIndex: 0,
}));

/** All five correct -> 100%, comfortably above the 70% pass mark. */
const PASSING_ANSWERS = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 };
const FAILING_ANSWERS = { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1 };

function buildPrisma({
  enrolled = true,
  existingCertificate = null as any,
} = {}) {
  const certificates: any[] = existingCertificate ? [existingCertificate] : [];
  const scoreRows: any[] = [];
  const tx = {
    issuedCertificate: {
      findFirst: jest.fn(async () => certificates[0] ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cert-${certificates.length + 1}`, ...data };
        certificates.push(row);
        return row;
      }),
    },
    providerScore: {
      findUnique: jest.fn(async () => scoreRows[0] ?? null),
      upsert: jest.fn(async ({ create, update }: any) => {
        const row = { ...(scoreRows[0] ?? create), ...update };
        scoreRows[0] = row;
        return row;
      }),
    },
  };

  return {
    __certificates: certificates,
    __scoreRows: scoreRows,
    __tx: tx,
    courseQuiz: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'quiz-1',
        courseId: 'course-1',
        questionsJson: QUESTIONS,
        course: { id: 'course-1', title: 'Gestão Financeira Executiva' },
      }),
    },
    courseEnrollment: {
      findUnique: jest.fn().mockResolvedValue(enrolled ? { id: 'enroll-1' } : null),
    },
    quizAttempt: {
      create: jest.fn(async ({ data }: any) => ({ id: 'attempt-1', ...data })),
    },
    issuedCertificate: {
      findFirst: jest.fn(async () => certificates[0] ?? null),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'learner@example.com',
        profile: { name: 'Ana Souza' },
      }),
    },
    providerScore: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
}

function buildService(prisma: any) {
  const storage = { uploadBuffer: jest.fn().mockResolvedValue('https://s3.example.com/cert.pdf') };
  const service = new CertificateService(prisma as any, buildConfig() as any, storage as any);
  return { service, storage };
}

describe('CertificateService.submitQuiz — enrollment gate', () => {
  it('rejects a caller who never enrolled in (never bought) the course', async () => {
    const prisma = buildPrisma({ enrolled: false });
    const { service, storage } = buildService(prisma);

    await expect(
      service.submitQuiz('user-1', { quizId: 'quiz-1', answers: PASSING_ANSWERS } as any),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.submitQuiz('user-1', { quizId: 'quiz-1', answers: PASSING_ANSWERS } as any),
    ).rejects.toThrow(/must be enrolled in this course/);

    // Nothing at all happens: no attempt row, no PDF, no certificate, no score.
    expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('checks enrollment against the quiz\'s own course', async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma);

    await service.submitQuiz('user-1', { quizId: 'quiz-1', answers: PASSING_ANSWERS } as any);

    expect(prisma.courseEnrollment.findUnique).toHaveBeenCalledWith({
      where: { userId_courseId: { userId: 'user-1', courseId: 'course-1' } },
    });
  });
});

describe('CertificateService.submitQuiz — one certificate, one bonus', () => {
  it('issues the certificate and awards +50 K-Score on the first pass, in one transaction', async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma);

    const result = await service.submitQuiz('user-1', {
      quizId: 'quiz-1',
      answers: PASSING_ANSWERS,
    } as any);

    expect(result.attempt.passed).toBe(true);
    expect(result.certificate).toBeDefined();
    expect(prisma.__certificates).toHaveLength(1);

    // Certificate insert and score bump share ONE transaction (they used to be
    // a Promise.all of two independent writes).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.__tx.issuedCertificate.create).toHaveBeenCalledTimes(1);
    expect(prisma.__tx.providerScore.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.__tx.providerScore.upsert.mock.calls[0][0].update.financialHealthScore).toBe(550);
  });

  it('does not award a second certificate or a second bonus on a repeat pass', async () => {
    const prisma = buildPrisma({
      existingCertificate: { id: 'cert-existing', userId: 'user-1', courseId: 'course-1' },
    });
    const { service, storage } = buildService(prisma);

    const result = await service.submitQuiz('user-1', {
      quizId: 'quiz-1',
      answers: PASSING_ANSWERS,
    } as any);

    expect(result.certificate).toEqual({ id: 'cert-existing', userId: 'user-1', courseId: 'course-1' });
    expect(prisma.__certificates).toHaveLength(1);
    // No re-render, no re-upload, no second score bump.
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // The attempt itself is still recorded.
    expect(prisma.quizAttempt.create).toHaveBeenCalledTimes(1);
  });

  it('returns the existing certificate when a concurrent submission won the race', async () => {
    const prisma = buildPrisma();
    // Pre-check sees nothing, but by the time the transaction runs another
    // request has already inserted — the in-transaction re-check catches it.
    prisma.issuedCertificate.findFirst.mockResolvedValueOnce(null);
    prisma.__tx.issuedCertificate.findFirst.mockResolvedValueOnce({ id: 'cert-raced' });
    const { service } = buildService(prisma);

    const result = await service.submitQuiz('user-1', {
      quizId: 'quiz-1',
      answers: PASSING_ANSWERS,
    } as any);

    expect(result.certificate).toEqual({ id: 'cert-raced' });
    expect(prisma.__tx.issuedCertificate.create).not.toHaveBeenCalled();
    expect(prisma.__tx.providerScore.upsert).not.toHaveBeenCalled();
  });

  it('awards nothing on a failing attempt', async () => {
    const prisma = buildPrisma();
    const { service, storage } = buildService(prisma);

    const result = await service.submitQuiz('user-1', {
      quizId: 'quiz-1',
      answers: FAILING_ANSWERS,
    } as any);

    expect(result.attempt.passed).toBe(false);
    expect(result.certificate).toBeNull();
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
