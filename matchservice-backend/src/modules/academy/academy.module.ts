import { Module } from '@nestjs/common';
import { AcademyService } from './academy.service';
import { AcademyController } from './academy.controller';
import { AiFactoryService } from './ai-factory.service';
import { QuizGeneratorService } from './quiz-generator.service';
import { CertificateService } from './certificate.service';
import { ConnectModule } from '../fintech/connect.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [ConnectModule, StorageModule],
  providers: [AcademyService, AiFactoryService, QuizGeneratorService, CertificateService],
  controllers: [AcademyController],
  exports: [AcademyService],
})
export class AcademyModule {}
