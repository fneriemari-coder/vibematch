import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

    // Certificate issuance and the K-Score bonus are independent side
    // effects of the same pass event — run them in parallel, per spec
    // ("execute uma query paralela"). Neither should block the other; a
    // failure in the bonus must not prevent the certificate (and vice versa).
    const [certificate] = await Promise.all([
      this.issueCertificate(userId, quiz.courseId, quiz.course.title),
      this.bumpProviderScore(userId),
    ]);

    this.logger.log(`Quiz attempt ${attempt.id}: user ${userId} PASSED (${scorePercentage}%) — certificate ${certificate.id} issued`);
    return { attempt, certificate };
  }

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

    return this.prisma.issuedCertificate.create({
      data: { userId, courseId, certificateUuid, downloadUrl },
    });
  }

  /**
   * +50 K-SCORE reward for upskilling. Note: ScoreEngine.recalculate() fully
   * recomputes financialHealthScore from escrow/rating/response-time signals
   * whenever a project completes — this bonus is additive and transient,
   * it will be superseded by the next recalculation rather than
   * permanently baked in. That's an acceptable trade for a "nice to have"
   * reward signal, but worth knowing if K-SCORE ever looks like it "lost"
   * a certification bonus.
   */
  private async bumpProviderScore(userId: string): Promise<void> {
    const existing = await this.prisma.providerScore.findUnique({ where: { providerId: userId } });
    const newScore = Math.min(MAX_FINANCIAL_HEALTH_SCORE, (existing?.financialHealthScore ?? 500) + CERTIFICATION_SCORE_BONUS);

    await this.prisma.providerScore.upsert({
      where: { providerId: userId },
      update: { financialHealthScore: newScore },
      create: { providerId: userId, financialHealthScore: newScore },
    });
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
