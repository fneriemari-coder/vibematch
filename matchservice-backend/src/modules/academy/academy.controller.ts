import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AcademyService } from './academy.service';
import { AiFactoryService } from './ai-factory.service';
import { QuizGeneratorService } from './quiz-generator.service';
import { CertificateService } from './certificate.service';
import { BuyCourseDto } from './dto/buy-course.dto';
import { GenerateAiCourseDto } from './dto/generate-ai-course.dto';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import { ListCoursesQueryDto } from './dto/list-courses-query.dto';
import { ListMentorsQueryDto } from './dto/list-mentors-query.dto';
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

  /**
   * Course catalogue for the Academy tab. Declared before the `:courseId`
   * route below — Nest matches in declaration order, and a bare
   * `GET /academy/courses` would otherwise be swallowed by that param route.
   */
  @Get('courses')
  listCourses(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCoursesQueryDto,
  ) {
    return this.academyService.listCourses(user.id, query.search, query.limit, query.offset);
  }

  /**
   * Curated mentors directory — profiles an admin has elevated with
   * `isMentor`. Declared ahead of the parameterised routes below for the same
   * declaration-order reason as `courses` above.
   */
  @Get('mentors')
  listMentors(@Query() query: ListMentorsQueryDto) {
    return this.academyService.listMentors(query.search, query.limit, query.offset);
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

  /** Instructor-only — see QuizGeneratorService.generateQuiz. */
  @Post('generate-quiz/:courseId')
  generateQuiz(@CurrentUser() user: AuthenticatedUser, @Param('courseId') courseId: string) {
    return this.quizGeneratorService.generateQuiz(user.id, courseId);
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
