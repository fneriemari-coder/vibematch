import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AcademyService } from './academy.service';
import { AiFactoryService } from './ai-factory.service';
import { QuizGeneratorService } from './quiz-generator.service';
import { CertificateService } from './certificate.service';
import { BuyCourseDto } from './dto/buy-course.dto';
import { GenerateAiCourseDto } from './dto/generate-ai-course.dto';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('academy')
@UseGuards(JwtAuthGuard)
export class AcademyController {
  constructor(
    private readonly academyService: AcademyService,
    private readonly aiFactoryService: AiFactoryService,
    private readonly quizGeneratorService: QuizGeneratorService,
    private readonly certificateService: CertificateService,
  ) {}

  @Post('buy-course')
  buyCourse(@CurrentUser() user: AuthenticatedUser, @Body() dto: BuyCourseDto) {
    return this.academyService.initiatePurchase(user.id, dto.courseId);
  }

  /** Course + ordered modules — powers the Flutter VibeAcademyScreen (video player + material PDF). */
  @Get('courses/:courseId')
  getCourseDetail(@Param('courseId') courseId: string) {
    return this.academyService.getCourseDetail(courseId);
  }

  /** Generates a full 3-module course (scope, voice scripts, simulated lesson videos, real PDF material pack). */
  @Post('generate-ai-course')
  generateAiCourse(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateAiCourseDto) {
    return this.aiFactoryService.generateCourse(user.id, dto);
  }

  @Post('generate-quiz/:courseId')
  generateQuiz(@Param('courseId') courseId: string) {
    return this.quizGeneratorService.generateQuiz(courseId);
  }

  /** Grades the attempt; on >=70% issues a certificate PDF + K-SCORE bonus. */
  @Post('submit-quiz')
  submitQuiz(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitQuizDto) {
    return this.certificateService.submitQuiz(user.id, dto);
  }

  /**
   * Feeds the "swipe deck under the lesson video" upsell: skills the course
   * teaches, matched against active providers' profiles and Discovery Feed
   * posts, so a business owner can hire the practical execution immediately.
   */
  @Get('course-connections/:courseId')
  getCourseConnections(@Param('courseId') courseId: string) {
    return this.academyService.getCourseConnections(courseId);
  }
}
