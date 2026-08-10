import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ScoreEngine } from './score.engine';

@Module({
  providers: [UsersService, ScoreEngine],
  controllers: [UsersController],
  exports: [UsersService, ScoreEngine],
})
export class UsersModule {}
