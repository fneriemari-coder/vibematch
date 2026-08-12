import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CourseCoverService } from '../academy/course-cover.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminCoursesController {
  constructor(private readonly courseCoverService: CourseCoverService) {}

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
}
