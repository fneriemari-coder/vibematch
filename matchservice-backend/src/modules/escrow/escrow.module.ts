import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { UsersModule } from '../users/users.module';
import { FintechModule } from '../fintech/fintech.module';
import { ConnectModule } from '../fintech/connect.module';

// ConnectModule is imported directly (not via FintechModule) for the same
// cycle-avoidance reason documented on ConnectModule itself: EscrowService
// needs ConnectService to push a real Stripe Transfer on completion.
@Module({
  imports: [UsersModule, FintechModule, ConnectModule],
  providers: [EscrowService],
  controllers: [EscrowController],
  exports: [EscrowService],
})
export class EscrowModule {}
