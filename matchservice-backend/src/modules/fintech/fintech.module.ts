import { Module } from '@nestjs/common';
import { FintechService } from './fintech.service';
import { FintechController } from './fintech.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BnplService } from './bnpl.service';
import { BnplController } from './bnpl.controller';
import { BnplInstallmentChargerService } from './bnpl-installment-charger.service';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { AntiFraudGuard } from './guards/anti-fraud.guard';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceController } from './maintenance.controller';
import { ConnectModule } from './connect.module';
import { AcademyModule } from '../academy/academy.module';
import { MastermindModule } from '../mastermind/mastermind.module';
import { CommunitiesModule } from '../communities/communities.module';
import { MentorshipModule } from '../mentorship/mentorship.module';

@Module({
  imports: [MentorshipModule, AcademyModule, MastermindModule, CommunitiesModule, ConnectModule],
  providers: [
    FintechService,
    StripeWebhookService,
    BillingService,
    BnplService,
    BnplInstallmentChargerService,
    IdentityService,
    AntiFraudGuard,
    MaintenanceService,
  ],
  controllers: [
    FintechController,
    StripeWebhookController,
    BillingController,
    BnplController,
    IdentityController,
    MaintenanceController,
  ],
  exports: [FintechService, MaintenanceService],
})
export class FintechModule {}
