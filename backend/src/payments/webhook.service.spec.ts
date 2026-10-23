import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { OrderStatus, PaymentStatus, Prisma } from '../generated/prisma/client';
import type { Payment } from '../generated/prisma/client';
import { StripeWebhookService } from './webhook.service';
import type { StripeConfig } from './stripe.config';

const ORDER_ID = 'order-1';
const PAYMENT_ID = 'pay-1';
const SESSION_ID = 'cs_test_1';
const EVENT_ID = 'evt_1';
const TOTAL_AMOUNT = '199.00';

const config: StripeConfig = {
  secretKey: 'sk_test_x',
  currency: 'usd',
  successUrl: 'https://app.example.com/success',
  cancelUrl: 'https://app.example.com/cancel',
  webhookSecret: 'whsec_test',
};

type OrderRow = { id: string; status: OrderStatus };
type PaymentRow = Payment & { orderId: string };

function createHarness() {
  const state = {
    events: new Set<string>(),
    orders: new Map<string, OrderRow>(),
    payments: new Map<string, PaymentRow>(),
    failNextPaymentUpdate: false,
  };

  const matchStatus = (filter: unknown, value: string): boolean => {
    if (filter === undefined) {
      return true;
    }
    if (typeof filter === 'string') {
      return filter === value;
    }
    if (filter && typeof filter === 'object') {
      if ('not' in filter) {
        return value !== (filter as { not: string }).not;
      }
      if ('in' in filter) {
        return (filter as { in: string[] }).in.includes(value);
      }
    }
    return true;
  };

  const makePayment = (data: Partial<PaymentRow> = {}): PaymentRow => ({
    id: PAYMENT_ID,
    orderId: ORDER_ID,
    idempotencyKey: 'key-1',
    status: PaymentStatus.PENDING,
    amount: new Prisma.Decimal(TOTAL_AMOUNT),
    provider: 'STRIPE',
    providerRef: null,
    checkoutSessionId: SESSION_ID,
    checkoutUrl: 'https://checkout.stripe.test/cs_test_1',
    reconciliationRequired: false,
    reconciliationReason: null,
    createdAt: new Date('2026-10-11T00:00:00.000Z'),
    updatedAt: new Date('2026-10-11T00:00:00.000Z'),
    ...data,
  });

  const tx = {
    processedWebhookEvent: {
      create: jest.fn(async ({ data }: { data: { id: string } }) => {
        if (state.events.has(data.id)) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: (`id`)',
            { code: 'P2002', clientVersion: '7.10.0' },
          );
        }
        state.events.add(data.id);
        return data;
      }),
    },
    payment: {
      findUnique: jest.fn(
        async ({ where }: { where: { checkoutSessionId?: string; id?: string } }) => {
          if (where.checkoutSessionId !== undefined) {
            for (const payment of state.payments.values()) {
              if (payment.checkoutSessionId === where.checkoutSessionId) {
                return {
                  ...payment,
                  order: state.orders.get(payment.orderId),
                };
              }
            }
            return null;
          }
          return state.payments.get(where.id as string) ?? null;
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        for (const payment of state.payments.values()) {
          if (where.orderId && payment.orderId !== where.orderId) continue;
          if (!matchStatus(where.status, payment.status)) continue;
          if (where.id?.not && payment.id === where.id.not) continue;
          return payment;
        }
        return null;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Record<string, any>; data: any }) => {
          if (state.failNextPaymentUpdate) {
            state.failNextPaymentUpdate = false;
            throw new Error('database write failed');
          }
          const current = state.payments.get(where.id);
          if (!current || !matchStatus(where.status, current.status)) {
            return { count: 0 };
          }
          state.payments.set(current.id, { ...current, ...data });
          return { count: 1 };
        },
      ),
    },
    order: {
      updateMany: jest.fn(
        async ({ where, data }: { where: Record<string, any>; data: any }) => {
          const current = state.orders.get(where.id);
          if (!current || !matchStatus(where.status, current.status)) {
            return { count: 0 };
          }
          state.orders.set(current.id, { ...current, status: data.status });
          return { count: 1 };
        },
      ),
    },
  };

  const prisma = {
    $transaction: jest.fn(
      async (callback: (t: typeof tx) => Promise<unknown>) => {
        const snapshot = {
          events: new Set(state.events),
          orders: new Map(state.orders),
          payments: new Map(state.payments),
        };
        try {
          return await callback(tx);
        } catch (error) {
          state.events = snapshot.events;
          state.orders = snapshot.orders;
          state.payments = snapshot.payments;
          throw error;
        }
      },
    ),
  };

  return {
    prisma,
    state,
    tx,
    seedOrder: (id: string, status: OrderStatus) =>
      state.orders.set(id, { id, status }),
    seedPayment: (data: Partial<PaymentRow> = {}) => {
      const payment = makePayment(data);
      state.payments.set(payment.id, payment);
      return payment;
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 19900,
    currency: 'usd',
    payment_intent: 'pi_1',
    client_reference_id: ORDER_ID,
    metadata: { orderId: ORDER_ID },
    ...overrides,
  };
}

function event(
  type: string,
  sessionObject: Record<string, unknown>,
  id = EVENT_ID,
): Stripe.Event {
  return { id, type, data: { object: sessionObject } } as unknown as Stripe.Event;
}

function makeService(harness: Harness, client: unknown, cfg = config) {
  return new StripeWebhookService(
    cfg,
    harness.prisma as never,
    client as Stripe,
  );
}

function makeClient(returnedEvent: Stripe.Event) {
  return { webhooks: { constructEvent: jest.fn(() => returnedEvent) } };
}

const RAW = Buffer.from('{"raw":"body"}');
const SIG = 't=1,v1=signature';

describe('StripeWebhookService', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('verifies the signature and confirms a successful payment (order PAID)', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const client = makeClient(
      event('checkout.session.completed', session()),
    );
    const service = makeService(harness, client);

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('PROCESSED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.SUCCEEDED,
    );
    expect(harness.state.payments.get(PAYMENT_ID)?.providerRef).toBe('pi_1');
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(OrderStatus.PAID);
    expect(client.webhooks.constructEvent).toHaveBeenCalledWith(
      RAW,
      SIG,
      'whsec_test',
    );
  });

  it('rejects an invalid signature without touching the database', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const client = {
      webhooks: {
        constructEvent: jest.fn(() => {
          throw new Error('No signatures found matching the expected signature');
        }),
      },
    };
    const service = makeService(harness, client);

    await expect(service.handleStripeEvent(RAW, SIG)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.PENDING,
    );
  });

  it('handles a missing webhook signing secret safely', async () => {
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
      { ...config, webhookSecret: undefined },
    );

    await expect(service.handleStripeEvent(RAW, SIG)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header and a missing raw body', async () => {
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
    );

    await expect(service.handleStripeEvent(RAW, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.handleStripeEvent(undefined, SIG),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.handleStripeEvent(Buffer.alloc(0), SIG),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates only the payment and order matched by the Checkout Session id', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ id: PAYMENT_ID, checkoutSessionId: SESSION_ID });
    harness.seedOrder('order-2', OrderStatus.PROCESSING);
    harness.seedPayment({
      id: 'pay-2',
      orderId: 'order-2',
      checkoutSessionId: 'cs_other',
    });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
    );

    await service.handleStripeEvent(RAW, SIG);

    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.SUCCEEDED,
    );
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(OrderStatus.PAID);
    expect(harness.state.payments.get('pay-2')?.status).toBe(
      PaymentStatus.PENDING,
    );
    expect(harness.state.orders.get('order-2')?.status).toBe(
      OrderStatus.PROCESSING,
    );
  });

  it('does not repeat state changes for a duplicate event', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
    );

    const first = await service.handleStripeEvent(RAW, SIG);
    const paymentUpdatesAfterFirst =
      harness.tx.payment.updateMany.mock.calls.length;

    const second = await service.handleStripeEvent(RAW, SIG);

    expect(first.disposition).toBe('PROCESSED');
    expect(second.disposition).toBe('DUPLICATE');
    expect(harness.tx.payment.updateMany.mock.calls.length).toBe(
      paymentUpdatesAfterFirst,
    );
    expect(harness.tx.processedWebhookEvent.create).toHaveBeenCalledTimes(2);
  });

  it('handles concurrent duplicate deliveries with a single effect', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
    );

    const [a, b] = await Promise.all([
      service.handleStripeEvent(RAW, SIG),
      service.handleStripeEvent(RAW, SIG),
    ]);

    const dispositions = [a.disposition, b.disposition].sort();
    expect(dispositions).toEqual(['DUPLICATE', 'PROCESSED']);
    expect(harness.tx.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.tx.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('ignores an event whose session id matches no payment attempt', async () => {
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session({ id: 'cs_unknown' }))),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('IGNORED');
    // The event is still recorded so a retry does not reprocess it.
    expect(harness.state.events.has(EVENT_ID)).toBe(true);
    expect(harness.tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an event whose amount does not match the payment', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(
        event('checkout.session.completed', session({ amount_total: 100 })),
      ),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('IGNORED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.PENDING,
    );
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(
      OrderStatus.PROCESSING,
    );
  });

  it('rejects an event whose currency does not match the payment', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(
        event('checkout.session.completed', session({ currency: 'eur' })),
      ),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('IGNORED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.PENDING,
    );
  });

  it('does not mark an order paid when the completed session is not actually paid', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(
        event(
          'checkout.session.completed',
          session({ payment_status: 'unpaid' }),
        ),
      ),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('IGNORED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.PENDING,
    );
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(
      OrderStatus.PROCESSING,
    );
  });

  it('handles an expired session by failing the attempt and freeing the order', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(
        event(
          'checkout.session.expired',
          session({ payment_status: 'unpaid' }),
        ),
      ),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('PROCESSED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.FAILED,
    );
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(
      OrderStatus.PENDING,
    );
  });

  it('does not free the order gate while another attempt is still in flight', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ id: PAYMENT_ID, checkoutSessionId: SESSION_ID });
    harness.seedPayment({
      id: 'pay-2',
      idempotencyKey: 'key-2',
      checkoutSessionId: 'cs_second',
      status: PaymentStatus.PENDING,
    });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.expired', session())),
    );

    await service.handleStripeEvent(RAW, SIG);

    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.FAILED,
    );
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(
      OrderStatus.PROCESSING,
    );
  });

  it('never downgrades a successful payment when an old failure/expiry arrives', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PAID);
    harness.seedPayment({ status: PaymentStatus.SUCCEEDED });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.expired', session())),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('IGNORED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.SUCCEEDED,
    );
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(OrderStatus.PAID);
    expect(harness.tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it('returns an error and leaves no event row when the database write fails (retryable)', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
    );

    harness.state.failNextPaymentUpdate = true;
    await expect(service.handleStripeEvent(RAW, SIG)).rejects.toThrow(
      /database write failed/,
    );
    // The claim was rolled back, so Stripe's retry can reprocess the event.
    expect(harness.state.events.has(EVENT_ID)).toBe(false);
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.PENDING,
    );

    const retry = await service.handleStripeEvent(RAW, SIG);
    expect(retry.disposition).toBe('PROCESSED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.SUCCEEDED,
    );
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(OrderStatus.PAID);
  });

  it('records a late successful payment for a cancelled order for reconciliation', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.CANCELLED);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('RECONCILIATION_REQUIRED');
    const payment = harness.state.payments.get(PAYMENT_ID);
    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payment?.reconciliationRequired).toBe(true);
    expect(payment?.reconciliationReason).toBe(
      'LATE_SUCCESS_ORDER_CANCELLED',
    );
    // The cancelled order is never flipped to PAID.
    expect(harness.state.orders.get(ORDER_ID)?.status).toBe(
      OrderStatus.CANCELLED,
    );
  });

  it('flags a second successful payment on an already-paid order for reconciliation', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PAID);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const service = makeService(
      harness,
      makeClient(event('checkout.session.completed', session())),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('RECONCILIATION_REQUIRED');
    expect(
      harness.state.payments.get(PAYMENT_ID)?.reconciliationReason,
    ).toBe('SECOND_SUCCESS_ORDER_ALREADY_PAID');
  });

  it('confirms payment on async_payment_succeeded and fails it on async_payment_failed', async () => {
    harness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    harness.seedPayment({ status: PaymentStatus.PENDING });
    const succeedService = makeService(
      harness,
      makeClient(event('checkout.session.async_payment_succeeded', session(), 'evt_ok')),
    );

    const success = await succeedService.handleStripeEvent(RAW, SIG);
    expect(success.disposition).toBe('PROCESSED');
    expect(harness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.SUCCEEDED,
    );

    const failHarness = createHarness();
    failHarness.seedOrder(ORDER_ID, OrderStatus.PROCESSING);
    failHarness.seedPayment({ status: PaymentStatus.PENDING });
    const failService = makeService(
      failHarness,
      makeClient(
        event(
          'checkout.session.async_payment_failed',
          session({ payment_status: 'unpaid' }),
          'evt_fail',
        ),
      ),
    );

    const failure = await failService.handleStripeEvent(RAW, SIG);
    expect(failure.disposition).toBe('PROCESSED');
    expect(failHarness.state.payments.get(PAYMENT_ID)?.status).toBe(
      PaymentStatus.FAILED,
    );
    expect(failHarness.state.orders.get(ORDER_ID)?.status).toBe(
      OrderStatus.PENDING,
    );
  });

  it('acknowledges unsupported event types without writing anything', async () => {
    const service = makeService(
      harness,
      makeClient(event('payment_intent.succeeded', session())),
    );

    const result = await service.handleStripeEvent(RAW, SIG);

    expect(result.disposition).toBe('IGNORED');
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.state.events.size).toBe(0);
  });
});
