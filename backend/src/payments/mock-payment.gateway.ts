import { Injectable } from '@nestjs/common';
import { PaymentGateway } from './payment-gateway.interface';
import type {
  CheckoutGateway,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
} from './checkout-gateway.interface';

@Injectable()
export class MockPaymentGateway implements PaymentGateway, CheckoutGateway {
  readonly providerName = 'MOCK';
  readonly currency = 'usd';

  async charge(input: {
    amount: number;
    currency: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<{
    success: boolean;
    providerRef: string;
  }> {
    return {
      success: true,
      providerRef: `mock_${input.orderId}_${input.idempotencyKey}`,
    };
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const sessionId = `cs_mock_${input.idempotencyKey}`;
    return {
      sessionId,
      url: `https://mock.checkout.local/orders/${input.orderId}?session=${sessionId}`,
    };
  }
}
