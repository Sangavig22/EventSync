import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PAYMENT_GATEWAY } from './payment-gateway.interface';
import { CHECKOUT_GATEWAY } from './checkout-gateway.interface';
import type { CheckoutGateway } from './checkout-gateway.interface';
import { MockPaymentGateway } from './mock-payment.gateway';
import { StripePaymentGateway } from './stripe-payment.gateway';
import { STRIPE_CONFIG, loadStripeConfig } from './stripe.config';
import type { StripeConfig } from './stripe.config';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments.webhook.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhookService } from './webhook.service';

/**
 * Loads the Stripe settings once. `null` means no STRIPE_SECRET_KEY is set, the
 * signal to fall back to the in-process mock checkout gateway.
 */
const stripeConfigProvider = {
  provide: STRIPE_CONFIG,
  useFactory: (): StripeConfig | null => loadStripeConfig(),
};

/**
 * Uses Stripe Checkout when STRIPE_SECRET_KEY and the redirect URLs are
 * configured, and the in-process mock otherwise. The mock keeps local dev and
 * the test suite working without network access or credentials.
 */
const checkoutGatewayProvider = {
  provide: CHECKOUT_GATEWAY,
  useFactory: (config: StripeConfig | null): CheckoutGateway =>
    config ? new StripePaymentGateway(config) : new MockPaymentGateway(),
  inject: [STRIPE_CONFIG],
};

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [
    PaymentsService,
    StripeWebhookService,
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },
    stripeConfigProvider,
    checkoutGatewayProvider,
  ],
})
export class PaymentsModule {}
