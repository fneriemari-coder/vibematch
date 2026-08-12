import { Module } from '@nestjs/common';
import { AcademyService } from './academy.service';
import { AcademyController } from './academy.controller';
import { AiFactoryService } from './ai-factory.service';
import { QuizGeneratorService } from './quiz-generator.service';
import { CertificateService } from './certificate.service';
import { CourseCoverService } from './course-cover.service';
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
  ],
  controllers: [AcademyController],
  // AdminModule imports this for POST /admin/courses/covers, so an operator
  // can fill the shelf on demand instead of waiting for a boot that finds it
  // bare.
  exports: [AcademyService, CourseCoverService],
})
export class AcademyModule {}
