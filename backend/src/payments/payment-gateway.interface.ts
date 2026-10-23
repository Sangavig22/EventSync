export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';

export interface PaymentGateway {
  charge(input: {
    amount: number;
    currency: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<{
    success: boolean;
    providerRef: string;
  }>;
}
