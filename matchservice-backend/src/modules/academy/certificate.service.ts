import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3StorageService } from '../../common/storage/s3-storage.service';
import { QuizQuestion } from './quiz-generator.service';
import { SubmitQuizDto } from './dto/submit-quiz.dto';

const PASSING_SCORE_PERCENTAGE = 70;
const CERTIFICATION_SCORE_BONUS = 50;
const MAX_FINANCIAL_HEALTH_SCORE = 1000;

/**
 * Grades a submitted quiz attempt and, on a passing score, issues an
 * Executive Certificate PDF (dark theme, real pdfkit render, real S3
 * upload) plus a one-time +50 K-SCORE bonus for the learner.
 */
@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: S3StorageService,
  ) {}

  async submitQuiz(userId: string, dto: SubmitQuizDto) {
    const quiz = await this.prisma.courseQuiz.findUnique({
      where: { id: dto.quizId },
      include: { course: true },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');

    // The exam is part of the course the caller bought. Without this check any
    // authenticated user could submit any quiz by id and walk away with a
    // certificate — and +50 K-Score — for a course they never paid for; the
    // K-Score is what gates paid community seats and ranks the mentor
    // directory, so it was a free path into both.
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId: quiz.courseId } },
    });
    if (!enrollment) {
      throw new ForbiddenException('You must be enrolled in this course to take its exam');
    }

    const questions = quiz.questionsJson as unknown as QuizQuestion[];
    const total = questions.length;
    let correct = 0;
    questions.forEach((q, index) => {
      if (dto.answers[String(index)] === q.correctAnswerIndex) correct++;
    });
    const scorePercentage = total > 0 ? Number(((correct / total) * 100).toFixed(1)) : 0;
    const passed = scorePercentage >= PASSING_SCORE_PERCENTAGE;

    const attempt = await this.prisma.quizAttempt.create({
      data: { userId, quizId: quiz.id, scorePercentage, passed },
    });

    if (!passed) {
      this.logger.log(`Quiz attempt ${attempt.id}: user ${userId} scored ${scorePercentage}% — not passed`);
      return { attempt, certificate: null };
    }

    // A course is certified once. Re-passing an exam previously minted a
    // fresh certificate AND another +50 K-Score every time.
    const existingCertificate = await this.prisma.issuedCertificate.findFirst({
      where: { userId, courseId: quiz.courseId },
    });
    if (existingCertificate) {
      this.logger.log(
        `Quiz attempt ${attempt.id}: user ${userId} PASSED (${scorePercentage}%) — certificate ` +
          `${existingCertificate.id} already issued for course ${quiz.courseId}, no new award`,
      );
      return { attempt, certificate: existingCertificate };
    }

    const certificate = await this.issueCertificate(userId, quiz.courseId, quiz.course.title);

    this.logger.log(`Quiz attempt ${attempt.id}: user ${userId} PASSED (${scorePercentage}%) — certificate ${certificate.id} issued`);
    return { attempt, certificate };
  }

  /**
   * Renders + uploads the PDF (slow, external), then commits the certificate
   * row AND the K-Score bonus in ONE transaction.
   *
   * These were a `Promise.all` of two independent writes, so two concurrent
   * passing submissions could each issue a certificate and each award the
   * bonus. The real arbiter is `@@unique([userId, courseId])` on
   * IssuedCertificate: the loser of a race gets P2002 and is handed the
   * winner's certificate, and because the score bump shares the transaction
   * it rolls back with the failed insert — so the +50 can never be awarded
   * twice, whatever the interleaving.
   */
  private async issueCertificate(userId: string, courseId: string, courseTitle: string) {
    const certificateUuid = randomUUID();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });

    const buffer = await this.renderCertificatePdf(user.profile?.name ?? user.email, courseTitle, certificateUuid);
    const downloadUrl = await this.storage.uploadBuffer(
      `academy/certificates/${certificateUuid}.pdf`,
      buffer,
      'application/pdf',
    );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // The unique constraint below is what actually enforces this; the
          // read just avoids a pointless constraint violation in the common case.
          const raced = await tx.issuedCertificate.findFirst({ where: { userId, courseId } });
          if (raced) return raced;

          const certificate = await tx.issuedCertificate.create({
            data: { userId, courseId, certificateUuid, downloadUrl },
          });

          // One-time +50 K-SCORE reward for upskilling. Note:
          // ScoreEngine.recalculate() fully recomputes financialHealthScore
          // from escrow/rating/response-time signals whenever a project
          // completes — this bonus is additive and transient, superseded by
          // the next recalculation rather than permanently baked in.
          const existingScore = await tx.providerScore.findUnique({ where: { providerId: userId } });
          const newScore = Math.min(
            MAX_FINANCIAL_HEALTH_SCORE,
            (existingScore?.financialHealthScore ?? 500) + CERTIFICATION_SCORE_BONUS,
          );
          await tx.providerScore.upsert({
            where: { providerId: userId },
            update: { financialHealthScore: newScore },
            create: { providerId: userId, financialHealthScore: newScore },
          });

          return certificate;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      const isDuplicate =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2002' || err.code === 'P2034'); // unique violation / serialization failure
      if (!isDuplicate) throw err;

      // The concurrent submission won — its certificate (and its single +50)
      // stand; this transaction, score bump included, rolled back.
      const alreadyIssued = await this.prisma.issuedCertificate.findFirst({
        where: { userId, courseId },
      });
      if (!alreadyIssued) throw err;

      this.logger.warn(
        `Concurrent certificate issuance for user ${userId}/course ${courseId} resolved to ` +
          `${alreadyIssued.id} (${err.code})`,
      );
      return alreadyIssued;
    }
  }

  private renderCertificatePdf(learnerName: string, courseTitle: string, certificateUuid: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { width, height } = doc.page;

      // Dark background
      doc.rect(0, 0, width, height).fill('#0A0A0C');

      // Gold border frame
      doc
        .lineWidth(2)
        .strokeColor('#F59E0B')
        .rect(30, 30, width - 60, height - 60)
        .stroke();

      // Logotype (text-based — no real logo asset in this repo)
      doc
        .fillColor('#F59E0B')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('VIBE MATCH', 0, 70, { align: 'center' });
      doc.fillColor('#9CA3AF').font('Helvetica').fontSize(10).text('EXECUTIVE ACADEMY', { align: 'center' });

      doc.moveDown(2);
      doc
        .fillColor('#F3F4F6')
        .font('Times-Italic')
        .fontSize(16)
        .text('Certificado de Conclusão', { align: 'center' });

      doc.moveDown(1.5);
      doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(30).text(learnerName, { align: 'center' });

      doc.moveDown(1);
      doc
        .fillColor('#D1D5DB')
        .font('Times-Roman')
        .fontSize(14)
        .text('concluiu com aproveitamento o programa executivo', { align: 'center' });

      doc.moveDown(0.5);
      doc.fillColor('#F59E0B').font('Times-BoldItalic').fontSize(20).text(courseTitle, { align: 'center' });

      doc.moveDown(3);
      doc
        .fillColor('#6B7280')
        .font('Courier')
        .fontSize(9)
        .text(`Autenticidade: ${certificateUuid}`, 0, height - 80, { align: 'center' });
      doc.text(`Emitido em ${new Date().toISOString().slice(0, 10)}`, { align: 'center' });

      doc.end();
    });
  }
}
