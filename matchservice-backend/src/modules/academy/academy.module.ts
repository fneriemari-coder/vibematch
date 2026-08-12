import { Module } from '@nestjs/common';
import { AcademyService } from './academy.service';
import { AcademyController } from './academy.controller';
import { AiFactoryService } from './ai-factory.service';
import { QuizGeneratorService } from './quiz-generator.service';
import { CertificateService } from './certificate.service';
import { CourseCoverService } from './course-cover.service';
import { LessonVideoService } from './lesson-video.service';
import { ConnectModule } from '../fintech/connect.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [ConnectModule, StorageModule],
  providers: [
    AcademyService,
    AiFactoryService,
    QuizGeneratorService,
    CertificateService,
    CourseCoverService,
    LessonVideoService,
  ],
  controllers: [AcademyController],
  // AdminModule imports these for POST /admin/courses/covers and
  // POST /admin/courses/videos, so an operator can fill the shelf on demand
  // instead of waiting for a boot that finds it bare.
  exports: [AcademyService, CourseCoverService, LessonVideoService],
})
export class AcademyModule {}
