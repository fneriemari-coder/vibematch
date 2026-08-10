import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { UsersModule } from '../users/users.module';
import { FintechModule } from '../fintech/fintech.module';

@Module({
  imports: [UsersModule, FintechModule],
  providers: [EscrowService],
  controllers: [EscrowController],
  exports: [EscrowService],
})
export class EscrowModule {}
