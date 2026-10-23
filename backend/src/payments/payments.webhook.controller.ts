import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookService } from './webhook.service';
import type { WebhookResult } from './webhook.service';

/**
 * Stripe webhook receiver.
 *
 * Deliberately NOT guarded by JwtAuthGuard: Stripe cannot send a user bearer
 * token. Authentication happens inside the service by verifying the
 * `Stripe-Signature` header against the raw request body, which is the
 * cryptographically stronger proof that the caller is Stripe. No other security
 * control (signature + idempotency + cross-checks) is relaxed.
 *
 * The raw body is required because signature verification hashes the exact bytes
 * Stripe sent; re-serializing parsed JSON would produce a different hash.
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly webhookService: StripeWebhookService) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  handleStripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<WebhookResult> {
    return this.webhookService.handleStripeEvent(req.rawBody, signature);
  }
}
