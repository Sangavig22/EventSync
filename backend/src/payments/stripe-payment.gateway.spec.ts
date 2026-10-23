import { StripePaymentGateway } from './stripe-payment.gateway';
import type { StripeConfig } from './stripe.config';

const config: StripeConfig = {
  secretKey: 'sk_test_x',
  currency: 'usd',
  successUrl: 'https://app.example.com/success',
  cancelUrl: 'https://app.example.com/cancel',
};

describe('StripePaymentGateway', () => {
  const create = jest.fn();

  const makeGateway = () =>
    new StripePaymentGateway(config, {
      checkout: { sessions: { create } },
    } as never);

  beforeEach(() => {
    create.mockReset();
  });

  it('exposes the provider name and configured currency', () => {
    const gateway = makeGateway();
    expect(gateway.providerName).toBe('STRIPE');
    expect(gateway.currency).toBe('usd');
  });

  it('creates a hosted session using minor units and the provider idempotency key', async () => {
    create.mockResolvedValue({
      id: 'cs_123',
      url: 'https://checkout.stripe.com/cs_123',
    });
    const gateway = makeGateway();

    const result = await gateway.createCheckoutSession({
      orderId: 'order-1',
      amountMinor: 19900,
      idempotencyKey: 'checkout:pay-1',
    });

    expect(result).toEqual({
      sessionId: 'cs_123',
      url: 'https://checkout.stripe.com/cs_123',
    });
    expect(create).toHaveBeenCalledTimes(1);

    const [params, options] = create.mock.calls[0];
    expect(params).toMatchObject({
      mode: 'payment',
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
      client_reference_id: 'order-1',
    });
    expect(params.line_items[0].price_data).toMatchObject({
      currency: 'usd',
      unit_amount: 19900,
    });
    expect(options).toEqual({ idempotencyKey: 'checkout:pay-1' });
  });

  it('throws when Stripe does not return a hosted URL', async () => {
    create.mockResolvedValue({ id: 'cs_123', url: null });
    const gateway = makeGateway();

    await expect(
      gateway.createCheckoutSession({
        orderId: 'order-1',
        amountMinor: 1,
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/Checkout URL/);
  });
});
