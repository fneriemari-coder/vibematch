import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ScoreEngine } from './score.engine';
import { DataPrivacyService } from './data-privacy.service';

@Module({
  providers: [UsersService, ScoreEngine, DataPrivacyService],
  controllers: [UsersController],
  exports: [UsersService, ScoreEngine],
})
export class UsersModule {}
