import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentStatus } from '../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard/jwt-auth.guard';
import { PaymentsService } from './payments.service';

type AuthedRequest = Request & { user: { userId: string } };

@Controller('orders')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * HTTP mapping of the pay outcome:
   * - SUCCEEDED -> 200 with the payment attempt.
   * - FAILED    -> 400 (definite gateway failure or a replayed failed attempt).
   * - PENDING   -> 409 with the pending attempt; the outcome is unknown and the
   *                gateway is NOT called again for it.
   */
  @Post(':orderId/pay')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async pay(@Req() req: AuthedRequest, @Param('orderId') orderId: string) {
    const idempotencyKey = this.requireIdempotencyKey(req);

    const result = await this.paymentsService.payOrder(
      orderId,
      req.user.userId,
      idempotencyKey,
    );

    if (result.kind === PaymentStatus.SUCCEEDED) {
      return result.payment;
    }

    if (result.kind === PaymentStatus.FAILED) {
      throw new BadRequestException('Payment failed');
    }

    throw new ConflictException({
      status: result.payment.status,
      payment: result.payment,
    });
  }

  /**
   * Creates a hosted checkout session and returns the payment attempt carrying
   * its `checkoutUrl` (and provider session id). The attempt stays PENDING here;
   * payment is only confirmed out of band via webhooks (Phase 2).
   * - PENDING   -> 200 with the session URL to redirect the customer to.
   * - SUCCEEDED -> 200 (already paid; replay idempotently returns the attempt).
   * - FAILED    -> 400.
   */
  @Post(':orderId/checkout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async checkout(@Req() req: AuthedRequest, @Param('orderId') orderId: string) {
    const idempotencyKey = this.requireIdempotencyKey(req);

    const result = await this.paymentsService.startCheckout(
      orderId,
      req.user.userId,
      idempotencyKey,
    );

    if (result.kind === PaymentStatus.FAILED) {
      throw new BadRequestException('Checkout failed');
    }

    return result.payment;
  }

  private requireIdempotencyKey(req: AuthedRequest): string {
    const header = req.headers['idempotency-key'];
    const idempotencyKey = (Array.isArray(header) ? header[0] : header)?.trim();

    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return idempotencyKey;
  }
}
