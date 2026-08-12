import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CourseCoverService } from '../academy/course-cover.service';
import { LessonVideoService } from '../academy/lesson-video.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminCoursesController {
  constructor(
    private readonly courseCoverService: CourseCoverService,
    private readonly lessonVideoService: LessonVideoService,
  ) {}

  /**
   * Generates cover art for courses that have none, and answers with the
   * per-course outcome — including why a given cover failed, and whether the
   * run was even attempted.
   *
   * That last part is the reason this returns a body rather than a 204: the
   * two ways this does nothing (no OpenAI key, no S3 bucket) look identical
   * from the shelf, since a course without a cover falls through to the drawn
   * one either way. `attempted: false` with a reason is what tells an operator
   * which credential is missing.
   *
   * 200 rather than 202: image generation is slow but the caller wants the
   * result, and the boot-time path already covers the fire-and-forget case.
   */
  @Post('covers')
  @HttpCode(HttpStatus.OK)
  generateCovers() {
    return this.courseCoverService.backfillMissingCovers();
  }

  /**
   * Renders narrated lesson videos for modules that have a script but no
   * video, and answers per module.
   *
   * Slow on purpose to call and slow to answer — each lesson is a speech
   * request plus an ffmpeg pass, and a batch of eight runs for minutes. That
   * is exactly why it is a route an operator triggers rather than something
   * boot does: a container still opening its port has better uses for its
   * cores. Reach for it again after it returns; the batch limit means one call
   * does not have to finish the whole catalogue.
   */
  @Post('videos')
  @HttpCode(HttpStatus.OK)
  renderLessonVideos() {
    return this.lessonVideoService.renderMissingVideos();
  }
}
