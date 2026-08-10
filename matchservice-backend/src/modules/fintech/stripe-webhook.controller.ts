import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * Raw-body Stripe webhook receiver. Requires the app bootstrap to register
 * this route with `express.raw({ type: 'application/json' })` (or an
 * equivalent raw-body middleware) BEFORE the global JSON body parser, since
 * Stripe's signature check needs the exact unparsed payload bytes — see
 * main.ts.
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private readonly stripeWebhookService: StripeWebhookService) {}

  @Post()
  @HttpCode(200)
  handle(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    return this.stripeWebhookService.handleEvent(req.body as Buffer, signature);
  }
}
