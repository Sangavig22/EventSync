import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '../generated/prisma/client';
import type { Payment } from '../generated/prisma/client';
import { PaymentsService } from './payments.service';
import type { PaymentGateway } from './payment-gateway.interface';
import type {
  CheckoutGateway,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
} from './checkout-gateway.interface';

const ORDER_ID = 'order-1';
const USER_ID = 'user-1';
const IDEMPOTENCY_KEY = 'key-1';
const TOTAL_AMOUNT = '199.00';

type OrderRow = {
  id: string;
  userId: string;
  status: OrderStatus;
  totalAmount: string;
};

class UnusedPaymentGateway implements PaymentGateway {
  async charge(): Promise<{ success: boolean; providerRef: string }> {
    throw new Error('startCheckout must not call the sync payment gateway');
  }
}

class FakeCheckoutGateway implements CheckoutGateway {
  readonly providerName = 'STRIPE';
  readonly currency = 'usd';
  readonly calls: CreateCheckoutSessionInput[] = [];
  result: CheckoutSessionResult = {
    sessionId: 'cs_test_1',
    url: 'https://checkout.stripe.test/cs_test_1',
  };
  error: Error | null = null;
  sawOpenTransaction = false;

  constructor(private readonly txState: { openTransactions: number }) {}

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    this.calls.push(input);
    if (this.txState.openTransactions > 0) {
      this.sawOpenTransaction = true;
    }
    if (this.error) {
      throw this.error;
    }
    return this.result;
  }
}

function createHarness(order?: OrderRow | null) {
  const state = {
    openTransactions: 0,
    order: (order === undefined
      ? {
          id: ORDER_ID,
          userId: USER_ID,
          status: OrderStatus.PENDING,
          totalAmount: TOTAL_AMOUNT,
        }
      : order) as OrderRow | null,
    payments: new Map<string, Payment>(),
    byKey: new Map<string, Payment>(),
    nextPaymentId: 1,
  };

  const key = (orderId: string, idempotencyKey: string) =>
    `${orderId}:${idempotencyKey}`;

  const makePayment = (data: {
    orderId: string;
    idempotencyKey: string;
    status: PaymentStatus;
    provider?: string;
    providerRef?: string;
    checkoutSessionId?: string;
    checkoutUrl?: string;
    id?: string;
  }): Payment => ({
    id: data.id ?? `payment-${state.nextPaymentId++}`,
    orderId: data.orderId,
    idempotencyKey: data.idempotencyKey,
    status: data.status,
    amount: new Prisma.Decimal(TOTAL_AMOUNT),
    provider: data.provider ?? 'STRIPE',
    providerRef: data.providerRef ?? null,
    checkoutSessionId: data.checkoutSessionId ?? null,
    checkoutUrl: data.checkoutUrl ?? null,
    reconciliationRequired: false,
    reconciliationReason: null,
    createdAt: new Date('2026-10-11T00:00:00.000Z'),
    updatedAt: new Date('2026-10-11T00:00:00.000Z'),
  });

  const tx = {
    $queryRaw: jest.fn(async () => {
      const row = state.order;
      return row ? [row] : [];
    }),
    payment: {
      findUnique: jest.fn(async ({ where }: any) =>
        state.byKey.get(
          key(
            where.orderId_idempotencyKey.orderId,
            where.orderId_idempotencyKey.idempotencyKey,
          ),
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const payment = makePayment({
          ...data,
          status: PaymentStatus.PENDING,
        });
        state.byKey.set(
          key(payment.orderId, payment.idempotencyKey),
          payment,
        );
        state.payments.set(payment.id, payment);
        return payment;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const current = state.payments.get(where.id);
        if (!current || (where.status && current.status !== where.status)) {
          return { count: 0 };
        }
        state.payments.set(current.id, { ...current, ...data });
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const current = state.payments.get(where.id);
        if (!current) {
          throw new Error('payment not found');
        }
        return current;
      }),
    },
    order: {
      update: jest.fn(async ({ where, data }: any) => {
        if (!state.order || state.order.id !== where.id) {
          throw new Error('order not found');
        }
        state.order = { ...state.order, status: data.status };
        return state.order;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!state.order || state.order.id !== where.id) {
          return { count: 0 };
        }
        state.order = { ...state.order, status: data.status };
        return { count: 1 };
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(
      async (callback: (t: typeof tx) => Promise<unknown>) => {
        state.openTransactions += 1;
        try {
          return await callback(tx);
        } finally {
          state.openTransactions -= 1;
        }
      },
    ),
  };

  return { tx, prisma, state, key, makePayment };
}

describe('PaymentsService.startCheckout', () => {
  let harness: ReturnType<typeof createHarness>;
  let gateway: FakeCheckoutGateway;
  let service: PaymentsService;

  beforeEach(() => {
    harness = createHarness();
    gateway = new FakeCheckoutGateway(harness.state);
    service = new PaymentsService(
      new UnusedPaymentGateway(),
      harness.prisma as never,
      gateway,
    );
  });

  it('creates a hosted session, stores its id/url, and leaves the attempt PENDING', async () => {
    const result = await service.startCheckout(
      ORDER_ID,
      USER_ID,
      IDEMPOTENCY_KEY,
    );

    expect(result.kind).toBe(PaymentStatus.PENDING);
    expect(result.payment.status).toBe(PaymentStatus.PENDING);
    expect(result.payment.checkoutUrl).toBe(gateway.result.url);
    expect(result.payment.checkoutSessionId).toBe(gateway.result.sessionId);
    expect(result.payment.providerRef).toBe(gateway.result.sessionId);
    expect(result.payment.provider).toBe('STRIPE');
    expect(result.payment.providerRef).not.toMatch(/^mock/);

    const persisted = harness.state.payments.get(result.payment.id);
    expect(persisted?.checkoutUrl).toBe(gateway.result.url);

    // Payment stays in flight: the order gate is held until confirmation.
    expect(harness.state.order?.status).toBe(OrderStatus.PROCESSING);

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toEqual({
      orderId: ORDER_ID,
      amountMinor: 19900,
      idempotencyKey: `checkout:${result.payment.id}`,
    });
    expect(gateway.sawOpenTransaction).toBe(false);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('replays the stored session for the same idempotency key without creating another', async () => {
    const payment = harness.makePayment({
      orderId: ORDER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      status: PaymentStatus.PENDING,
      checkoutSessionId: 'cs_stored',
      checkoutUrl: 'https://checkout.stripe.test/cs_stored',
    });
    harness.state.byKey.set(
      harness.key(ORDER_ID, IDEMPOTENCY_KEY),
      payment,
    );
    harness.state.payments.set(payment.id, payment);
    harness.state.order!.status = OrderStatus.PROCESSING;

    const result = await service.startCheckout(
      ORDER_ID,
      USER_ID,
      IDEMPOTENCY_KEY,
    );

    expect(result.kind).toBe(PaymentStatus.PENDING);
    expect(result.payment.id).toBe(payment.id);
    expect(result.payment.checkoutUrl).toBe('https://checkout.stripe.test/cs_stored');
    expect(gateway.calls).toHaveLength(0);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('leaves the attempt PENDING and the order PROCESSING when session creation fails', async () => {
    gateway.error = new Error('stripe unavailable');

    const result = await service.startCheckout(
      ORDER_ID,
      USER_ID,
      IDEMPOTENCY_KEY,
    );

    expect(result.kind).toBe(PaymentStatus.PENDING);
    expect(result.payment.checkoutUrl).toBeNull();
    const persisted = harness.state.payments.get(result.payment.id);
    expect(persisted?.status).toBe(PaymentStatus.PENDING);
    expect(harness.state.order?.status).toBe(OrderStatus.PROCESSING);
    expect(gateway.calls).toHaveLength(1);
    // Only the reservation transaction ran; nothing was persisted on failure.
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a different idempotency key while the order is being processed', async () => {
    harness.state.order!.status = OrderStatus.PROCESSING;

    await expect(
      service.startCheckout(ORDER_ID, USER_ID, 'key-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.calls).toHaveLength(0);
  });

  it('fails when no checkout gateway is configured', async () => {
    const unconfigured = new PaymentsService(
      new UnusedPaymentGateway(),
      harness.prisma as never,
    );

    await expect(
      unconfigured.startCheckout(ORDER_ID, USER_ID, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/not configured/);
    expect(gateway.calls).toHaveLength(0);
  });
});
