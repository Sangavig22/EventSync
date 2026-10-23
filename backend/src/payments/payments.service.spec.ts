import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '../generated/prisma/client';
import type { Payment } from '../generated/prisma/client';
import { PaymentsService } from './payments.service';
import type { PaymentGateway } from './payment-gateway.interface';

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

class FakeGateway implements PaymentGateway {
  public calls: Array<{
    amount: number;
    currency: string;
    orderId: string;
    idempotencyKey: string;
  }> = [];
  public result: { success: boolean; providerRef: string } = {
    success: true,
    providerRef: 'mock_order-1_key-1',
  };
  public error: Error | null = null;
  public sawOpenTransaction = false;

  constructor(
    private readonly txState: { openTransactions: number },
  ) {}

  async charge(input: {
    amount: number;
    currency: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ success: boolean; providerRef: string }> {
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
    findUniqueReturnNullOnce: false,
  };

  const key = (orderId: string, idempotencyKey: string) =>
    `${orderId}:${idempotencyKey}`;

  const makePayment = (data: {
    orderId: string;
    idempotencyKey: string;
    status: PaymentStatus;
    providerRef?: string;
    id?: string;
  }): Payment => ({
    id: data.id ?? `payment-${state.nextPaymentId++}`,
    orderId: data.orderId,
    idempotencyKey: data.idempotencyKey,
    status: data.status,
    amount: new Prisma.Decimal(TOTAL_AMOUNT),
    provider: 'MOCK',
    providerRef: data.providerRef ?? null,
    checkoutSessionId: null,
    checkoutUrl: null,
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
      findUnique: jest.fn(async ({ where }: any) => {
        if (state.findUniqueReturnNullOnce) {
          state.findUniqueReturnNullOnce = false;
          return null;
        }
        return (
          state.byKey.get(
            key(
              where.orderId_idempotencyKey.orderId,
              where.orderId_idempotencyKey.idempotencyKey,
            ),
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const k = key(data.orderId, data.idempotencyKey);
        if (state.byKey.has(k)) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: (`orderId`,`idempotencyKey`)',
            { code: 'P2002', clientVersion: '7.10.0' },
          );
        }
        const payment = makePayment({
          ...data,
          status: PaymentStatus.PENDING,
        });
        state.byKey.set(k, payment);
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
        if (
          !state.order ||
          state.order.id !== where.id ||
          state.order.status !== where.status
        ) {
          return { count: 0 };
        }
        state.order = { ...state.order, status: data.status };
        return { count: 1 };
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => {
      state.openTransactions += 1;
      try {
        return await callback(tx);
      } finally {
        state.openTransactions -= 1;
      }
    }),
  };

  return { tx, prisma, state, key, makePayment };
}

describe('PaymentsService', () => {
  let harness: ReturnType<typeof createHarness>;
  let gateway: FakeGateway;
  let service: PaymentsService;

  beforeEach(() => {
    harness = createHarness();
    gateway = new FakeGateway(harness.state);
    service = new PaymentsService(
      gateway as unknown as PaymentGateway,
      harness.prisma as never,
    );
  });

  const seedPayment = (payment: Payment) => {
    harness.state.byKey.set(
      harness.key(payment.orderId, payment.idempotencyKey),
      payment,
    );
    harness.state.payments.set(payment.id, payment);
  };

  it('charges outside any transaction and records success', async () => {
    const result = await service.payOrder(
      ORDER_ID,
      USER_ID,
      IDEMPOTENCY_KEY,
    );

    expect(result.kind).toBe(PaymentStatus.SUCCEEDED);
    expect(result.payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(result.payment.providerRef).toBe('mock_order-1_key-1');
    expect(harness.state.order?.status).toBe(OrderStatus.PAID);
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toMatchObject({
      orderId: ORDER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      amount: 199,
    });
    expect(gateway.sawOpenTransaction).toBe(false);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('replays a previous success without calling the gateway again', async () => {
    const payment = harness.makePayment({
      orderId: ORDER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      status: PaymentStatus.SUCCEEDED,
      providerRef: 'first-ref',
    });
    seedPayment(payment);
    harness.state.order!.status = OrderStatus.PAID;

    const result = await service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY);

    expect(result.kind).toBe(PaymentStatus.SUCCEEDED);
    expect(result.payment.id).toBe(payment.id);
    expect(result.payment.providerRef).toBe('first-ref');
    expect(gateway.calls).toHaveLength(0);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('replays a previous failure as FAILED without calling the gateway again', async () => {
    const payment = harness.makePayment({
      orderId: ORDER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      status: PaymentStatus.FAILED,
      providerRef: 'failed-ref',
    });
    seedPayment(payment);

    const result = await service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY);

    expect(result.kind).toBe(PaymentStatus.FAILED);
    expect(result.payment.id).toBe(payment.id);
    expect(gateway.calls).toHaveLength(0);
  });

  it('does not re-charge an existing PENDING attempt', async () => {
    const payment = harness.makePayment({
      orderId: ORDER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      status: PaymentStatus.PENDING,
    });
    seedPayment(payment);
    harness.state.order!.status = OrderStatus.PROCESSING;

    const result = await service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY);

    expect(result.kind).toBe(PaymentStatus.PENDING);
    expect(result.payment.id).toBe(payment.id);
    expect(gateway.calls).toHaveLength(0);
    expect(harness.state.order?.status).toBe(OrderStatus.PROCESSING);
  });

  it('records a definite gateway failure and frees the order again', async () => {
    gateway.result = { success: false, providerRef: 'mock_ref_failed' };

    const result = await service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY);

    expect(result.kind).toBe(PaymentStatus.FAILED);
    expect(result.payment.status).toBe(PaymentStatus.FAILED);
    expect(result.payment.providerRef).toBe('mock_ref_failed');
    expect(harness.state.order?.status).toBe(OrderStatus.PENDING);
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.sawOpenTransaction).toBe(false);
  });

  it('keeps the attempt PENDING and the order PROCESSING when the charge outcome is unknown', async () => {
    gateway.error = new Error('gateway timeout');

    const result = await service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY);

    expect(result.kind).toBe(PaymentStatus.PENDING);
    expect(result.payment.status).toBe(PaymentStatus.PENDING);
    expect(result.payment.providerRef).toBeNull();
    const persisted = harness.state.payments.get(result.payment.id);
    expect(persisted?.status).toBe(PaymentStatus.PENDING);
    expect(harness.state.order?.status).toBe(OrderStatus.PROCESSING);
    expect(gateway.calls).toHaveLength(1);
  });

  it('re-reads the concurrent attempt on a unique-constraint race instead of charging twice', async () => {
    const other = harness.makePayment({
      orderId: ORDER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      status: PaymentStatus.PENDING,
    });
    seedPayment(other);
    harness.state.findUniqueReturnNullOnce = true;

    const result = await service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY);

    expect(result.kind).toBe(PaymentStatus.PENDING);
    expect(result.payment.id).toBe(other.id);
    expect(gateway.calls).toHaveLength(0);
    expect(harness.tx.payment.create).toHaveBeenCalledTimes(1);
  });

  it('rejects another idempotency key while the order is already being processed', async () => {
    harness.state.order!.status = OrderStatus.PROCESSING;

    await expect(
      service.payOrder(ORDER_ID, USER_ID, 'key-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.calls).toHaveLength(0);
    expect(harness.state.byKey.has(harness.key(ORDER_ID, 'key-2'))).toBe(
      false,
    );
  });

  it('throws NotFound for an unknown order', async () => {
    harness.state.order = null;

    await expect(
      service.payOrder('missing-order', USER_ID, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(gateway.calls).toHaveLength(0);
  });

  it('throws Forbidden when the order belongs to another user', async () => {
    harness.state.order = {
      ...harness.state.order!,
      userId: 'someone-else',
    };

    await expect(
      service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(gateway.calls).toHaveLength(0);
  });

  it('throws BadRequest when the order cannot be paid', async () => {
    harness.state.order!.status = OrderStatus.PAID;

    await expect(
      service.payOrder(ORDER_ID, USER_ID, IDEMPOTENCY_KEY),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.calls).toHaveLength(0);
    expect(harness.state.byKey.size).toBe(0);
  });
});