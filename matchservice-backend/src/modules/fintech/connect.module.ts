import { Module } from '@nestjs/common';
import { ConnectService } from './connect.service';
import { ConnectController } from './connect.controller';

// Standalone module (no imports) so both FintechModule and AcademyModule can
// depend on ConnectService without creating a cycle — FintechModule already
// imports AcademyModule (for StripeWebhookService -> AcademyService), so
// AcademyService pulling ConnectService straight from FintechModule would
// close a loop. This module breaks that.
@Module({
  providers: [ConnectService],
  controllers: [ConnectController],
  exports: [ConnectService],
})
export class ConnectModule {}
