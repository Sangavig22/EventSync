import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '../generated/prisma/client';
import type { Payment } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_GATEWAY } from './payment-gateway.interface';
import type { PaymentGateway } from './payment-gateway.interface';
import { CHECKOUT_GATEWAY } from './checkout-gateway.interface';
import type {
  CheckoutGateway,
  CheckoutSessionResult,
} from './checkout-gateway.interface';
import { toMinorUnits } from './money';

/**
 * Outcome of a pay request aligned with the persisted Payment status.
 * SUCCEEDED / FAILED / PENDING map to 200 / 400 / 409 in the controller.
 */
export type PayOrderResult = {
  kind: PaymentStatus;
  payment: Payment;
};

type LockedOrder = {
  id: string;
  userId: string;
  status: string;
  totalAmount: string;
};

type ChargeResult = { success: boolean; providerRef: string };

/**
 * Result of the reservation transaction:
 * - 'CHARGED' means a fresh PENDING attempt was created and the gateway may now
 *   be called. The other kinds are replayed outcomes of an existing attempt and
 *   must never trigger a second gateway call.
 */
type ReservedAttempt =
  | { kind: 'CHARGED'; payment: Payment }
  | { kind: PaymentStatus; payment: Payment };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHECKOUT_GATEWAY)
    private readonly checkoutGateway?: CheckoutGateway,
  ) {}

  async payOrder(
    orderId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<PayOrderResult> {
    const reserved = await this.reserveAttempt(
      orderId,
      userId,
      idempotencyKey,
      'MOCK',
    );

    if (reserved.kind !== 'CHARGED') {
      return { kind: reserved.kind, payment: reserved.payment };
    }

    let chargeResult: ChargeResult;
    try {
      // The external call happens with no database transaction, connection, or
      // order-row lock held. The PENDING attempt and the order's PROCESSING
      // status were durably committed before we got here.
      chargeResult = await this.paymentGateway.charge({
        amount: Number(reserved.payment.amount),
        currency: 'USD',
        orderId,
        idempotencyKey,
      });
    } catch (error) {
      // The outcome is unknown: the provider may or may not have charged. Never
      // mark it FAILED based on a timeout. Keep the persisted attempt PENDING and
      // the order PROCESSING until the result can be resolved by a provider
      // lookup. Resolving such attempts is out of scope for the mock gateway.
      this.logger.error(
        `Payment gateway call failed for payment ${reserved.payment.id} (order ${orderId}); attempt left PENDING`,
        error instanceof Error ? error.stack : undefined,
      );
      return { kind: PaymentStatus.PENDING, payment: reserved.payment };
    }

    return this.finalizeAttempt(reserved.payment.id, orderId, chargeResult);
  }

  /**
   * Redirect-based checkout (Stripe Checkout).
   * Reserves the same PENDING attempt as payOrder, then asks the checkout
   * gateway for a hosted session URL. The payment deliberately stays PENDING and
   * the order stays PROCESSING: only a verified provider confirmation may turn
   * it into SUCCEEDED (webhooks, Phase 2). Replaying the same idempotency key
   * returns the previously persisted session instead of creating a new one.
   */
  async startCheckout(
    orderId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<PayOrderResult> {
    const gateway = this.checkoutGateway;
    if (!gateway) {
      throw new InternalServerErrorException('Checkout is not configured');
    }

    const reserved = await this.reserveAttempt(
      orderId,
      userId,
      idempotencyKey,
      gateway.providerName,
    );

    if (reserved.kind !== 'CHARGED') {
      return { kind: reserved.kind, payment: reserved.payment };
    }

    const payment = reserved.payment;

    let session: CheckoutSessionResult;
    try {
      session = await gateway.createCheckoutSession({
        orderId,
        amountMinor: toMinorUnits(payment.amount, gateway.currency),
        idempotencyKey: `checkout:${payment.id}`,
      });
    } catch (error) {
      // The session may or may not have been created. Never record a fake
      // success or failure from an unknown outcome: keep the attempt PENDING
      // (and the order PROCESSING) so it can be reconciled later.
      this.logger.error(
        `Checkout session creation failed for payment ${payment.id} (order ${orderId}); attempt left PENDING`,
        error instanceof Error ? error.stack : undefined,
      );
      return { kind: PaymentStatus.PENDING, payment };
    }

    return this.persistCheckoutSession(payment.id, session);
  }

  /**
   * Short transaction that records the provider session id and URL on the
   * reserved attempt. Status is untouched: it remains PENDING until confirmed.
   */
  private async persistCheckoutSession(
    paymentId: string,
    session: CheckoutSessionResult,
  ): Promise<PayOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: paymentId, status: PaymentStatus.PENDING },
        data: {
          providerRef: session.sessionId,
          checkoutSessionId: session.sessionId,
          checkoutUrl: session.url,
        },
      });

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });

      return { kind: payment.status, payment };
    });
  }

  /**
   * Step 1 - Reserve the attempt.
   * Short transaction, no external calls. Locks the order row, then either:
   * - re-reads an existing attempt for this (orderId, idempotencyKey) and
   *   returns its current status (never charges again), or
   * - validates the order is payable, persists a PENDING attempt, and marks the
   *   order PROCESSING so a different key cannot race a second charge.
   */
  private async reserveAttempt(
    orderId: string,
    userId: string,
    idempotencyKey: string,
    provider: string,
  ): Promise<ReservedAttempt> {
    return this.prisma.$transaction(async (tx) => {
      const [lockedOrder] = await tx.$queryRaw<LockedOrder[]>`
        SELECT "id", "userId", "status", "totalAmount"
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;

      if (!lockedOrder) {
        throw new NotFoundException(`Order with id ${orderId} not found`);
      }

      if (lockedOrder.userId !== userId) {
        throw new ForbiddenException('You do not have access to this order');
      }

      const existing = await tx.payment.findUnique({
        where: { orderId_idempotencyKey: { orderId, idempotencyKey } },
      });

      if (existing) {
        return { kind: existing.status, payment: existing };
      }

      if (lockedOrder.status !== OrderStatus.PENDING) {
        throw new BadRequestException(
          `Order cannot be paid in its current status: ${lockedOrder.status}`,
        );
      }

      try {
        const payment = await tx.payment.create({
          data: {
            orderId,
            idempotencyKey,
            amount: lockedOrder.totalAmount,
            provider,
            status: PaymentStatus.PENDING,
          },
        });

        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.PROCESSING },
        });

        return { kind: 'CHARGED', payment };
      } catch (error) {
        // A unique-constraint conflict on (orderId, idempotencyKey) means another
        // request reserved this key first. Re-read and return that attempt instead
        // of charging a second time.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const duplicate = await tx.payment.findUnique({
            where: { orderId_idempotencyKey: { orderId, idempotencyKey } },
          });
          if (duplicate) {
            return { kind: duplicate.status, payment: duplicate };
          }
        }
        throw error;
      }
    });
  }

  /**
   * Step 3 - Finalize.
   * Short transaction that records the charge outcome. The conditional
   * `updateMany` on status PENDING makes finalization idempotent: only the
   * first finalizer transitions the attempt, later repeats observe zero rows
   * and return the already-persisted status.
   */
  private async finalizeAttempt(
    paymentId: string,
    orderId: string,
    chargeResult: ChargeResult,
  ): Promise<PayOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.applyChargeOutcome(
        tx,
        paymentId,
        orderId,
        chargeResult,
      );
      return { kind: payment.status, payment };
    });
  }

  private async applyChargeOutcome(
    tx: Prisma.TransactionClient,
    paymentId: string,
    orderId: string,
    chargeResult: ChargeResult,
  ): Promise<Payment> {
    const targetStatus = chargeResult.success
      ? PaymentStatus.SUCCEEDED
      : PaymentStatus.FAILED;

    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: { status: targetStatus, providerRef: chargeResult.providerRef },
    });

    // Nothing updated: the attempt was already finalized (e.g. a repeated
    // finalization call). A SUCCEEDED attempt is terminal and is never
    // downgraded to FAILED.
    if (count === 0) {
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    }

    // Clear the in-flight order gate once the outcome is known.
    await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PROCESSING },
      data: {
        status: chargeResult.success
          ? OrderStatus.PAID
          : OrderStatus.PENDING,
      },
    });

    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }
}