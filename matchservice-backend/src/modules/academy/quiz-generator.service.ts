import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface QuizQuestion {
  question: string;
  options: string[]; // exactly 4
  correctAnswerIndex: number; // 0-3
}

const QUIZ_SCHEMA = {
  name: 'course_quiz',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
            correctAnswerIndex: { type: 'integer', minimum: 0, maximum: 3 },
          },
          required: ['question', 'options', 'correctAnswerIndex'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
} as const;

/** Generates a pragmatic, scenario-based 5-question exam from a course's lesson scripts. */
@Injectable()
export class QuizGeneratorService {
  private readonly logger = new Logger(QuizGeneratorService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  async generateQuiz(courseId: string) {
    const course = await this.prisma.businessCourse.findUnique({
      where: { id: courseId },
      include: { modules: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!course) throw new NotFoundException('Course not found');

    const lessonText = course.modules.length
      ? course.modules.map((m) => `## ${m.title}\n${m.voiceScript}`).join('\n\n')
      : `${course.title}\n${course.description}`;

    const questions = await this.generateQuestions(lessonText);

    const quiz = await this.prisma.courseQuiz.upsert({
      where: { courseId },
      update: { questionsJson: questions as any },
      create: { courseId, questionsJson: questions as any },
    });

    this.logger.log(`Quiz generated for course ${courseId} (${questions.length} questions)`);
    return quiz;
  }

  private async generateQuestions(lessonText: string): Promise<QuizQuestion[]> {
    const completion = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.3,
      response_format: { type: 'json_schema', json_schema: QUIZ_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            'Você é o avaliador de exames de uma plataforma de educação executiva corporativa. Gere uma prova de 5 questões de múltipla escolha ' +
            'pragmáticas, baseadas em cenários reais de negócio (não decoreba), a partir do conteúdo das aulas ' +
            'fornecido. Cada questão tem exatamente 4 alternativas e um índice correto (0-3).',
        },
        { role: 'user', content: lessonText.slice(0, 12_000) },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty completion from OpenAI while generating quiz');
    return (JSON.parse(raw) as { questions: QuizQuestion[] }).questions;
  }
}
