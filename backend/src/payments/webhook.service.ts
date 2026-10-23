import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { OrderStatus, PaymentStatus, Prisma } from '../generated/prisma/client';
import type { Payment } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toMinorUnits } from './money';
import { STRIPE_CONFIG } from './stripe.config';
import type { StripeConfig } from './stripe.config';

/**
 * How a verified webhook was handled. Every value is a success from Stripe's
 * point of view (2xx) - the difference is only what we did:
 * - PROCESSED: the event changed (or confirmed) our state.
 * - DUPLICATE: we had already processed this event id; nothing to do.
 * - IGNORED:   the event is irrelevant to us or cannot be safely applied (for
 *              example an unmatched session or a data mismatch). Retrying would
 *              not help, so we acknowledge it.
 * - RECONCILIATION_REQUIRED: a real payment was recorded but could not be
 *              applied to its order (e.g. a late success after cancellation).
 *              An operator must reconcile/refund it.
 */
export type WebhookDisposition =
  | 'PROCESSED'
  | 'DUPLICATE'
  | 'IGNORED'
  | 'RECONCILIATION_REQUIRED';

export interface WebhookResult {
  received: true;
  disposition: WebhookDisposition;
  eventId?: string;
  eventType?: string;
}

/**
 * Stripe Checkout events we understand. The account is configured for Checkout
 * in `payment` mode; card payments resolve synchronously, while delayed payment
 * methods settle later via the `async_payment_*` events. Handling both keeps the
 * implementation correct without adding any payment methods of its own.
 */
const SUPPORTED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

type PaymentWithOrder = Payment & { order: { id: string; status: string } };

/**
 * Verifies and applies Stripe webhook events.
 *
 * Trust model: nothing in the request is trusted until the Stripe SDK has
 * verified the signature over the *raw* request body using STRIPE_WEBHOOK_SECRET.
 * The resulting event is then matched to a persisted payment attempt by its
 * Checkout Session id - never by client-supplied amounts or order ids.
 *
 * Idempotency: each event id is inserted into ProcessedWebhookEvent inside the
 * same short transaction that applies the payment/order changes, so we never
 * commit "processed" before (or after) the effects. A duplicate insert is a
 * unique-constraint violation, which we treat as an already-handled event. No
 * network call to Stripe happens inside a database transaction.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  private readonly config: StripeConfig | null;
  private readonly client: Stripe | null;

  constructor(
    @Inject(STRIPE_CONFIG) config: StripeConfig | null,
    private readonly prisma: PrismaService,
    @Optional() client?: Stripe,
  ) {
    this.config = config;
    this.client = client ?? (config ? new Stripe(config.secretKey) : null);
  }

  async handleStripeEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookResult> {
    const config = this.config;
    if (!config || !config.webhookSecret || !this.client) {
      throw new ServiceUnavailableException(
        'Stripe webhook is not configured',
      );
    }

    if (!signature) {
      throw new BadRequestException('Missing Stripe signature header');
    }

    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Missing raw request body');
    }

    let event: Stripe.Event;
    try {
      // The SDK recomputes the HMAC over the exact raw bytes. We must never
      // re-serialize the parsed JSON for verification - the bytes would differ.
      event = this.client.webhooks.constructEvent(
        rawBody,
        signature,
        config.webhookSecret,
      );
    } catch {
      this.logger.warn('Rejected Stripe webhook with an invalid signature');
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    return this.applyEvent(event);
  }

  private async applyEvent(event: Stripe.Event): Promise<WebhookResult> {
    if (!SUPPORTED_EVENT_TYPES.has(event.type)) {
      this.logger.debug(
        `Ignoring unsupported Stripe event ${event.id} (${event.type})`,
      );
      return this.result('IGNORED', event);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Claim the event id first. A concurrent/duplicate delivery blocks on
        // the unique index until this transaction commits, then fails here.
        await tx.processedWebhookEvent.create({
          data: { id: event.id, type: event.type },
        });

        return this.dispatch(tx, event);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        this.logger.log(`Duplicate Stripe event ${event.id} acknowledged`);
        return this.result('DUPLICATE', event);
      }

      // A genuine failure rolls back the event row too, so Stripe's retry
      // reprocesses it from a clean slate. Propagate to produce a 5xx.
      this.logger.error(
        `Failed to process Stripe event ${event.id} (${event.type})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private dispatch(
    tx: Prisma.TransactionClient,
    event: Stripe.Event,
  ): Promise<WebhookResult> {
    const session = event.data.object as unknown as Stripe.Checkout.Session;

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return this.applySuccessfulPayment(tx, event, session);
      case 'checkout.session.async_payment_failed':
        return this.applyFailedPayment(tx, event, session);
      case 'checkout.session.expired':
        return this.applyExpiredSession(tx, event, session);
      default:
        return Promise.resolve(this.result('IGNORED', event));
    }
  }

  /**
   * A Checkout Session that Stripe reports as paid. Only `payment_status:
   * 'paid'` proves money moved - a completed session alone does not.
   */
  private async applySuccessfulPayment(
    tx: Prisma.TransactionClient,
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<WebhookResult> {
    const payment = await this.findPaymentForSession(tx, session.id);
    if (!payment) {
      return this.ignoreUnknownSession(event, session.id);
    }

    if (session.payment_status !== 'paid') {
      // Completed but not settled (e.g. a delayed payment method). Leave the
      // attempt PENDING; a later async_payment_succeeded confirms the money.
      this.logger.log(
        `Stripe session ${session.id} is not paid (payment_status=${session.payment_status ?? 'unknown'}); leaving payment ${payment.id} PENDING (event ${event.id})`,
      );
      return this.result('IGNORED', event);
    }

    const mismatch = this.validateAgainstPayment(session, payment);
    if (mismatch) {
      // Signature is valid but the session does not match our records. Applying
      // it could mark the wrong payment paid, so we refuse and log loudly.
      this.logger.error(
        `Stripe session ${session.id} rejected for payment ${payment.id}: ${mismatch} (event ${event.id})`,
      );
      return this.result('IGNORED', event);
    }

    const providerRef = this.paymentIntentRef(session, payment);
    const orderStatus = payment.order.status;
    const alreadySucceeded = payment.status === PaymentStatus.SUCCEEDED;

    if (orderStatus === OrderStatus.PAID && !alreadySucceeded) {
      // A different attempt already paid this order, so this is an extra real
      // charge for the same order. Record it and flag it rather than dropping it.
      await this.flagForReconciliation(
        tx,
        payment,
        providerRef,
        'SECOND_SUCCESS_ORDER_ALREADY_PAID',
      );
      this.logger.error(
        `Second successful payment ${payment.id} for already-paid order ${payment.orderId}; flagged for reconciliation (event ${event.id})`,
      );
      return this.result('RECONCILIATION_REQUIRED', event);
    }

    if (
      orderStatus !== OrderStatus.PROCESSING &&
      orderStatus !== OrderStatus.PENDING &&
      orderStatus !== OrderStatus.PAID
    ) {
      // Money moved, but the order can no longer be fulfilled (cancelled or
      // expired). Record the outcome and flag it - never silently drop a real
      // payment.
      await this.flagForReconciliation(
        tx,
        payment,
        providerRef,
        `LATE_SUCCESS_ORDER_${orderStatus}`,
      );
      this.logger.error(
        `Late successful payment ${payment.id} for ineligible order ${payment.orderId} (status=${orderStatus}); flagged for reconciliation (event ${event.id})`,
      );
      return this.result('RECONCILIATION_REQUIRED', event);
    }

    // Happy path: confirm this attempt (idempotent - a replayed success is a
    // no-op) and release the order gate. Only the first success flips PAID.
    await tx.payment.updateMany({
      where: { id: payment.id, status: { not: PaymentStatus.SUCCEEDED } },
      data: { status: PaymentStatus.SUCCEEDED, providerRef },
    });
    await tx.order.updateMany({
      where: {
        id: payment.orderId,
        status: { in: [OrderStatus.PROCESSING, OrderStatus.PENDING] },
      },
      data: { status: OrderStatus.PAID },
    });

    this.logger.log(
      `Confirmed payment ${payment.id} for order ${payment.orderId} (event ${event.id})`,
    );
    return this.result('PROCESSED', event);
  }

  /**
   * A session that failed or expired before payment. These must never downgrade
   * a payment that already succeeded, and must not release the order gate while
   * another attempt is still in flight.
   */
  private async applyFailedPayment(
    tx: Prisma.TransactionClient,
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<WebhookResult> {
    const payment = await this.findPaymentForSession(tx, session.id);
    if (!payment) {
      return this.ignoreUnknownSession(event, session.id);
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      this.logger.log(
        `Ignoring ${event.type} for already-succeeded payment ${payment.id} (event ${event.id})`,
      );
      return this.result('IGNORED', event);
    }

    if (payment.status === PaymentStatus.PENDING) {
      await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
    }

    await this.releaseOrderIfIdle(tx, payment);

    this.logger.log(
      `Recorded ${event.type} for payment ${payment.id} (event ${event.id})`,
    );
    return this.result('PROCESSED', event);
  }

  /**
   * An expired session is a terminal non-payment for *this* attempt. Unlike a
   * hard failure it is safer to return the order to PENDING so the customer can
   * retry, matching Phase 1's failure handling, rather than expiring the order.
   */
  private async applyExpiredSession(
    tx: Prisma.TransactionClient,
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<WebhookResult> {
    const payment = await this.findPaymentForSession(tx, session.id);
    if (!payment) {
      return this.ignoreUnknownSession(event, session.id);
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      this.logger.log(
        `Ignoring expired session ${session.id} for already-succeeded payment ${payment.id} (event ${event.id})`,
      );
      return this.result('IGNORED', event);
    }

    if (payment.status === PaymentStatus.PENDING) {
      await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
    }

    await this.releaseOrderIfIdle(tx, payment);

    this.logger.log(
      `Expired Checkout Session ${session.id} recorded for payment ${payment.id} (event ${event.id})`,
    );
    return this.result('PROCESSED', event);
  }

  /**
   * Free the order's PROCESSING gate after this attempt failed, but only if the
   * order is still processing and no newer attempt is still in flight. A paid
   * order (another attempt succeeded) is never touched.
   */
  private async releaseOrderIfIdle(
    tx: Prisma.TransactionClient,
    payment: PaymentWithOrder,
  ): Promise<void> {
    if (payment.order.status !== OrderStatus.PROCESSING) {
      return;
    }

    const otherPending = await tx.payment.findFirst({
      where: {
        orderId: payment.orderId,
        status: PaymentStatus.PENDING,
        id: { not: payment.id },
      },
      select: { id: true },
    });

    if (otherPending) {
      return;
    }

    await tx.order.updateMany({
      where: { id: payment.orderId, status: OrderStatus.PROCESSING },
      data: { status: OrderStatus.PENDING },
    });
  }

  private findPaymentForSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<PaymentWithOrder | null> {
    return tx.payment.findUnique({
      where: { checkoutSessionId: sessionId },
      include: { order: { select: { id: true, status: true } } },
    }) as Promise<PaymentWithOrder | null>;
  }

  private ignoreUnknownSession(
    event: Stripe.Event,
    sessionId: string,
  ): WebhookResult {
    this.logger.warn(
      `No payment attempt matches Stripe session ${sessionId}; ignoring event ${event.id} (${event.type})`,
    );
    return this.result('IGNORED', event);
  }

  /**
   * Cross-checks the (verified) session against the persisted attempt. Any
   * mismatch means we must not treat the session as proof of payment for this
   * order. The expected amount is derived from our own record - a client can
   * never influence it.
   */
  private validateAgainstPayment(
    session: Stripe.Checkout.Session,
    payment: PaymentWithOrder,
  ): string | null {
    const currency = this.config?.currency;
    if (!currency) {
      return 'webhook is not configured';
    }

    if (session.currency?.toLowerCase() !== currency) {
      return `currency mismatch (session=${session.currency ?? 'null'}, expected=${currency})`;
    }

    const expectedMinor = toMinorUnits(payment.amount, currency);
    if (session.amount_total !== expectedMinor) {
      return `amount mismatch (session=${session.amount_total ?? 'null'}, expected=${expectedMinor})`;
    }

    const metadataOrderId = session.metadata?.orderId;
    if (metadataOrderId && metadataOrderId !== payment.orderId) {
      return `metadata.orderId mismatch (session=${metadataOrderId}, expected=${payment.orderId})`;
    }

    if (
      session.client_reference_id &&
      session.client_reference_id !== payment.orderId
    ) {
      return `client_reference_id mismatch (session=${session.client_reference_id}, expected=${payment.orderId})`;
    }

    return null;
  }

  private async flagForReconciliation(
    tx: Prisma.TransactionClient,
    payment: PaymentWithOrder,
    providerRef: string | null,
    reason: string,
  ): Promise<void> {
    await tx.payment.updateMany({
      where: { id: payment.id, status: { not: PaymentStatus.SUCCEEDED } },
      data: {
        status: PaymentStatus.SUCCEEDED,
        providerRef,
        reconciliationRequired: true,
        reconciliationReason: reason,
      },
    });
  }

  private paymentIntentRef(
    session: Stripe.Checkout.Session,
    payment: PaymentWithOrder,
  ): string | null {
    const intent = session.payment_intent;
    if (typeof intent === 'string') {
      return intent;
    }
    return intent?.id ?? payment.providerRef ?? null;
  }

  private result(
    disposition: WebhookDisposition,
    event: Stripe.Event,
  ): WebhookResult {
    return {
      received: true,
      disposition,
      eventId: event.id,
      eventType: event.type,
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
