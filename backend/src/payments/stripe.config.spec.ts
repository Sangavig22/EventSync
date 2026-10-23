import { loadStripeConfig } from './stripe.config';

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  values as NodeJS.ProcessEnv;

describe('loadStripeConfig', () => {
  it('returns null when no secret key is configured', () => {
    expect(loadStripeConfig(env({}))).toBeNull();
    expect(loadStripeConfig(env({ STRIPE_SECRET_KEY: '   ' }))).toBeNull();
  });

  it('loads a full configuration and defaults the currency to usd', () => {
    expect(
      loadStripeConfig(
        env({
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_SUCCESS_URL: 'https://app.example.com/success',
          STRIPE_CANCEL_URL: 'https://app.example.com/cancel',
        }),
      ),
    ).toEqual({
      secretKey: 'sk_test_x',
      currency: 'usd',
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/cancel',
    });
  });

  it('reads the webhook signing secret when present', () => {
    const config = loadStripeConfig(
      env({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_SUCCESS_URL: 'https://app.example.com/success',
        STRIPE_CANCEL_URL: 'https://app.example.com/cancel',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
      }),
    );

    expect(config?.webhookSecret).toBe('whsec_test_123');
  });

  it('leaves the webhook signing secret undefined when absent or blank', () => {
    const base = {
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_SUCCESS_URL: 'https://app.example.com/success',
      STRIPE_CANCEL_URL: 'https://app.example.com/cancel',
    };

    expect(loadStripeConfig(env(base))?.webhookSecret).toBeUndefined();
    expect(
      loadStripeConfig(env({ ...base, STRIPE_WEBHOOK_SECRET: '   ' }))
        ?.webhookSecret,
    ).toBeUndefined();
  });

  it('lowercases the configured currency', () => {
    const config = loadStripeConfig(
      env({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_CURRENCY: 'EUR',
        STRIPE_SUCCESS_URL: 'https://app.example.com/success',
        STRIPE_CANCEL_URL: 'https://app.example.com/cancel',
      }),
    );

    expect(config?.currency).toBe('eur');
  });

  it('fails fast when the key is set without redirect URLs', () => {
    expect(() =>
      loadStripeConfig(env({ STRIPE_SECRET_KEY: 'sk_test_x' })),
    ).toThrow(/STRIPE_SUCCESS_URL/);
  });

  it('rejects non-http(s) redirect URLs', () => {
    expect(() =>
      loadStripeConfig(
        env({
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_SUCCESS_URL: 'javascript:alert(1)',
          STRIPE_CANCEL_URL: 'https://app.example.com/cancel',
        }),
      ),
    ).toThrow(/STRIPE_SUCCESS_URL/);
  });
});
