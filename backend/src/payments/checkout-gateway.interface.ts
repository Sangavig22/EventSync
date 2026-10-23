export const CHECKOUT_GATEWAY = 'CHECKOUT_GATEWAY';

/**
 * Business data for an async (redirect-based) checkout session. The amount is
 * already expressed in the currency's smallest unit (e.g. cents) so the adapter
 * never has to deal with floating point money.
 */
export interface CreateCheckoutSessionInput {
  orderId: string;
  amountMinor: number;
  /**
   * Stable idempotency key for the provider. Derived from the persisted payment
   * attempt id so retries of the same attempt reuse the same session.
   */
  idempotencyKey: string;
}

export interface CheckoutSessionResult {
  /** Provider-side session id, persisted for later reconciliation / webhooks. */
  sessionId: string;
  /** Hosted page the customer must be redirected to. */
  url: string;
}

/**
 * Adapter for redirect-based checkout providers (e.g. Stripe Checkout). Creating
 * a session does NOT confirm payment: the payment stays PENDING until the
 * provider confirms it out of band (webhooks, Phase 2).
 */
export interface CheckoutGateway {
  readonly providerName: string;
  /**
   * ISO 4217 currency (lowercase) this adapter charges in. Used by the caller to
   * convert the persisted order total into minor units.
   */
  readonly currency: string;
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult>;
}
