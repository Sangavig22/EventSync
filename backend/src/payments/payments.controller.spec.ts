import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentStatus } from '../generated/prisma/client';
import { PaymentsController } from './payments.controller';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: { payOrder: jest.Mock; startCheckout: jest.Mock };

  const USER_ID = 'user-1';

  beforeEach(() => {
    service = { payOrder: jest.fn(), startCheckout: jest.fn() };
    controller = new PaymentsController(service as never);
  });

  const req = (idempotencyHeader?: string, userId = USER_ID) =>
    ({
      headers: { 'idempotency-key': idempotencyHeader },
      user: { userId },
    }) as never;

  it('rejects a request without the idempotency key before calling the service', async () => {
    await expect(controller.pay(req(undefined), 'order-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.payOrder).not.toHaveBeenCalled();
  });

  it('trims and forwards the idempotency key', async () => {
    service.payOrder.mockResolvedValue({ kind: PaymentStatus.SUCCEEDED });
    await controller.pay(req('  key-1  ', 'user-9'), 'order-1');
    expect(service.payOrder).toHaveBeenCalledWith('order-1', 'user-9', 'key-1');
  });

  it('returns the payment on success', async () => {
    const payment = { id: 'pay-1', status: PaymentStatus.SUCCEEDED };
    service.payOrder.mockResolvedValue({ kind: PaymentStatus.SUCCEEDED, payment });
    await expect(controller.pay(req('key-1'), 'order-1')).resolves.toBe(payment);
  });

  it('throws BadRequest for a definite failure', async () => {
    service.payOrder.mockResolvedValue({
      kind: PaymentStatus.FAILED,
      payment: { id: 'pay-1', status: PaymentStatus.FAILED },
    });
    await expect(controller.pay(req('key-1'), 'order-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws Conflict with the pending attempt for an unknown outcome', async () => {
    const payment = { id: 'pay-1', status: PaymentStatus.PENDING };
    service.payOrder.mockResolvedValue({ kind: PaymentStatus.PENDING, payment });

    const promise = controller.pay(req('key-1'), 'order-1');
    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    await promise.catch((error) =>
      expect(error.getResponse()).toEqual({
        status: PaymentStatus.PENDING,
        payment,
      }),
    );
  });

  it('requires the idempotency key for checkout before calling the service', async () => {
    await expect(
      controller.checkout(req(undefined), 'order-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.startCheckout).not.toHaveBeenCalled();
  });

  it('returns the payment attempt carrying the checkout URL', async () => {
    const payment = {
      id: 'pay-1',
      status: PaymentStatus.PENDING,
      checkoutUrl: 'https://checkout.stripe.test/cs_1',
    };
    service.startCheckout.mockResolvedValue({
      kind: PaymentStatus.PENDING,
      payment,
    });

    await expect(
      controller.checkout(req('  key-1  ', 'user-9'), 'order-1'),
    ).resolves.toBe(payment);
    expect(service.startCheckout).toHaveBeenCalledWith(
      'order-1',
      'user-9',
      'key-1',
    );
  });

  it('returns the attempt when the order was already paid', async () => {
    const payment = { id: 'pay-1', status: PaymentStatus.SUCCEEDED };
    service.startCheckout.mockResolvedValue({
      kind: PaymentStatus.SUCCEEDED,
      payment,
    });

    await expect(controller.checkout(req('key-1'), 'order-1')).resolves.toBe(
      payment,
    );
  });

  it('throws BadRequest for a failed checkout', async () => {
    service.startCheckout.mockResolvedValue({
      kind: PaymentStatus.FAILED,
      payment: { id: 'pay-1', status: PaymentStatus.FAILED },
    });

    await expect(controller.checkout(req('key-1'), 'order-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});