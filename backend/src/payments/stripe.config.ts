export const STRIPE_CONFIG = 'STRIPE_CONFIG';

export interface StripeConfig {
  secretKey: string;
  /** ISO 4217, lowercase (e.g. 'usd'). */
  currency: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Signing secret (whsec_...) used to verify inbound webhook signatures. It is
   * optional: without it checkout still works, but the webhook endpoint cannot
   * verify deliveries and reports itself as unconfigured.
   */
  webhookSecret?: string;
}

const DEFAULT_CURRENCY = 'usd';

/**
 * Reads the Stripe settings from the environment.
 *
 * Returns null when STRIPE_SECRET_KEY is not set, which is the signal for the
 * module to fall back to the mock checkout gateway. When a key IS present the
 * rest of the settings must be valid, otherwise we fail fast at startup instead
 * of creating half-configured sessions at request time.
 */
export function loadStripeConfig(
  env: NodeJS.ProcessEnv = process.env,
): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return null;
  }

  const successUrl = env.STRIPE_SUCCESS_URL?.trim();
  const cancelUrl = env.STRIPE_CANCEL_URL?.trim();
  if (!successUrl || !cancelUrl) {
    throw new Error(
      'STRIPE_SECRET_KEY is set, so STRIPE_SUCCESS_URL and STRIPE_CANCEL_URL must be set too',
    );
  }

  assertHttpUrl(successUrl, 'STRIPE_SUCCESS_URL');
  assertHttpUrl(cancelUrl, 'STRIPE_CANCEL_URL');

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;

  return {
    secretKey,
    currency: (env.STRIPE_CURRENCY?.trim() || DEFAULT_CURRENCY).toLowerCase(),
    successUrl,
    cancelUrl,
    webhookSecret,
  };
}

function assertHttpUrl(value: string, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be an http(s) URL`);
  }
}
