import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import Stripe from 'stripe';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { STRIPE_CONFIG } from './../src/payments/stripe.config';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
} from './../src/generated/prisma/client';

const WEBHOOK_SECRET = 'whsec_e2e_test';
const SESSION_ID = 'cs_e2e_1';
const ORDER_ID = 'order-e2e';
const PAYMENT_ID = 'pay-e2e';

/**
 * Minimal in-memory stand-in for PrismaService so the webhook flow can be
 * exercised end-to-end over HTTP (raw body + signature + state transition)
 * without a running PostgreSQL. The real database behavior (unique constraint,
 * transaction rollback) is modelled here and covered in the unit tests.
 */
function createFakePrisma() {
  const events = new Set<string>();
  const orders = new Map<string, { id: string; status: OrderStatus }>([
    [ORDER_ID, { id: ORDER_ID, status: OrderStatus.PROCESSING }],
  ]);
  const payments = new Map<string, any>([
    [
      PAYMENT_ID,
      {
        id: PAYMENT_ID,
        orderId: ORDER_ID,
        idempotencyKey: 'k-e2e',
        status: PaymentStatus.PENDING,
        amount: new Prisma.Decimal('199.00'),
        provider: 'STRIPE',
        providerRef: null,
        checkoutSessionId: SESSION_ID,
        checkoutUrl: 'https://checkout.stripe.test/cs_e2e_1',
        reconciliationRequired: false,
        reconciliationReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  ]);

  const matchStatus = (filter: any, value: string): boolean => {
    if (filter === undefined) return true;
    if (typeof filter === 'string') return filter === value;
    if (filter && typeof filter === 'object') {
      if ('not' in filter) return value !== filter.not;
      if ('in' in filter) return (filter.in as string[]).includes(value);
    }
    return true;
  };

  const tx = {
    processedWebhookEvent: {
      create: async ({ data }: any) => {
        if (events.has(data.id)) {
          throw new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '7.10.0',
          });
        }
        events.add(data.id);
        return data;
      },
    },
    payment: {
      findUnique: async ({ where }: any) => {
        for (const payment of payments.values()) {
          if (payment.checkoutSessionId === where.checkoutSessionId) {
            return { ...payment, order: orders.get(payment.orderId) };
          }
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const payment of payments.values()) {
          if (where.orderId && payment.orderId !== where.orderId) continue;
          if (!matchStatus(where.status, payment.status)) continue;
          if (where.id?.not && payment.id === where.id.not) continue;
          return payment;
        }
        return null;
      },
      updateMany: async ({ where, data }: any) => {
        const current = payments.get(where.id);
        if (!current || !matchStatus(where.status, current.status)) {
          return { count: 0 };
        }
        payments.set(current.id, { ...current, ...data });
        return { count: 1 };
      },
    },
    order: {
      updateMany: async ({ where, data }: any) => {
        const current = orders.get(where.id);
        if (!current || !matchStatus(where.status, current.status)) {
          return { count: 0 };
        }
        orders.set(current.id, { ...current, status: data.status });
        return { count: 1 };
      },
    },
  };

  const prisma = {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async (callback: (t: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };

  return { prisma, events, orders, payments };
}

describe('Stripe webhook (e2e)', () => {
  let app: INestApplication<App>;
  let fake: ReturnType<typeof createFakePrisma>;

  const stripeConfig = {
    secretKey: 'sk_test_e2e',
    currency: 'usd',
    successUrl: 'https://app.example.com/success',
    cancelUrl: 'https://app.example.com/cancel',
    webhookSecret: WEBHOOK_SECRET,
  };

  beforeEach(async () => {
    fake = createFakePrisma();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(STRIPE_CONFIG)
      .useValue(stripeConfig)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const postWebhook = (payload: string, signature?: string) => {
    const req = request(app.getHttpServer())
      .post('/payments/webhook/stripe')
      .set('content-type', 'application/json');
    return signature
      ? req.set('stripe-signature', signature).send(payload)
      : req.send(payload);
  };

  const signedHeader = (payload: string) =>
    Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

  it('rejects an invalid signature with 400', async () => {
    const payload = JSON.stringify({
      id: 'evt_bad',
      type: 'checkout.session.completed',
      data: { object: {} },
    });

    await postWebhook(payload, 't=1,v1=not-a-real-signature').expect(400);
  });

  it('rejects a request without a signature with 400', async () => {
    await postWebhook('{}').expect(400);
  });

  it('acknowledges a validly signed but unsupported event', async () => {
    const payload = JSON.stringify({
      id: 'evt_ignored',
      type: 'payment_intent.created',
      data: { object: {} },
    });

    const response = await postWebhook(payload, signedHeader(payload)).expect(
      200,
    );

    expect(response.body.disposition).toBe('IGNORED');
    expect(fake.events.has('evt_ignored')).toBe(false);
  });

  it('confirms a validly signed successful payment and marks the order paid', async () => {
    const payload = JSON.stringify({
      id: 'evt_ok',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: SESSION_ID,
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 19900,
          currency: 'usd',
          payment_intent: 'pi_e2e',
          client_reference_id: ORDER_ID,
          metadata: { orderId: ORDER_ID },
        },
      },
    });

    const response = await postWebhook(payload, signedHeader(payload)).expect(
      200,
    );

    expect(response.body.disposition).toBe('PROCESSED');
    expect(fake.payments.get(PAYMENT_ID)?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(fake.orders.get(ORDER_ID)?.status).toBe(OrderStatus.PAID);
  });
});
