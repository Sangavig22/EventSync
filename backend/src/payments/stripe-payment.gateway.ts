import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import type {
  CheckoutGateway,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
} from './checkout-gateway.interface';
import type { StripeConfig } from './stripe.config';

/**
 * Stripe Checkout adapter. Only creates the hosted session; it never marks a
 * payment as paid - that happens when Stripe confirms the session (Phase 2
 * webhooks). The Stripe SDK is wrapped so the network call can be tested
 * without real credentials by injecting a client.
 */
@Injectable()
export class StripePaymentGateway implements CheckoutGateway {
  readonly providerName = 'STRIPE';

  private readonly client: Stripe;

  constructor(
    private readonly config: StripeConfig,
    client?: Stripe,
  ) {
    this.client = client ?? new Stripe(config.secretKey);
  }

  get currency(): string {
    return this.config.currency;
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const session = await this.client.checkout.sessions.create(
      {
        mode: 'payment',
        success_url: this.config.successUrl,
        cancel_url: this.config.cancelUrl,
        client_reference_id: input.orderId,
        metadata: { orderId: input.orderId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: this.config.currency,
              unit_amount: input.amountMinor,
              product_data: { name: `Order ${input.orderId}` },
            },
          },
        ],
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (!session.url) {
      throw new Error('Stripe did not return a hosted Checkout URL');
    }

    return { sessionId: session.id, url: session.url };
  }
}
