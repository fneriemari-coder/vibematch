import { Module } from '@nestjs/common';
import { SwipesService } from './swipes.service';
import { SwipesController } from './swipes.controller';

@Module({
  providers: [SwipesService],
  controllers: [SwipesController],
  exports: [SwipesService],
})
export class SwipesModule {}
