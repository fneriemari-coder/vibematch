import { Module } from '@nestjs/common';
import { MastermindService } from './mastermind.service';
import { MastermindController } from './mastermind.controller';
import { ConnectModule } from '../fintech/connect.module';

@Module({
  imports: [ConnectModule],
  providers: [MastermindService],
  controllers: [MastermindController],
  exports: [MastermindService],
})
export class MastermindModule {}
