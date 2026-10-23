import { PaymentsWebhookController } from './payments.webhook.controller';

describe('PaymentsWebhookController', () => {
  const handleStripeEvent = jest.fn();
  const controller = new PaymentsWebhookController({
    handleStripeEvent,
  } as never);

  beforeEach(() => {
    handleStripeEvent.mockReset();
  });

  it('forwards the raw body and the Stripe signature to the service', async () => {
    const raw = Buffer.from('{"id":"evt_1"}');
    const response = { received: true, disposition: 'PROCESSED' };
    handleStripeEvent.mockResolvedValue(response);

    await expect(
      controller.handleStripe({ rawBody: raw } as never, 't=1,v1=abc'),
    ).resolves.toBe(response);
    expect(handleStripeEvent).toHaveBeenCalledWith(raw, 't=1,v1=abc');
  });

  it('passes a missing signature through as undefined', async () => {
    handleStripeEvent.mockResolvedValue({ received: true, disposition: 'IGNORED' });

    await controller.handleStripe({ rawBody: Buffer.from('x') } as never, undefined);

    expect(handleStripeEvent).toHaveBeenCalledWith(expect.any(Buffer), undefined);
  });
});
