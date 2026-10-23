import { Prisma } from '../generated/prisma/client';
import { minorUnitExponent, toMinorUnits } from './money';

describe('money', () => {
  it('converts a two-decimal amount into minor units', () => {
    expect(toMinorUnits('199.00', 'usd')).toBe(19900);
    expect(toMinorUnits(new Prisma.Decimal('0.01'), 'usd')).toBe(1);
    expect(toMinorUnits('1234.56', 'USD')).toBe(123456);
  });

  it('treats zero-decimal currencies as whole units', () => {
    expect(minorUnitExponent('jpy')).toBe(0);
    expect(toMinorUnits('500', 'jpy')).toBe(500);
  });

  it('rejects amounts with sub-minor-unit precision instead of rounding', () => {
    expect(() => toMinorUnits('1.005', 'usd')).toThrow(/precision/);
  });

  it('rejects negative amounts', () => {
    expect(() => toMinorUnits('-1.00', 'usd')).toThrow(/negative/);
  });

  it('rejects amounts too large to represent safely', () => {
    expect(() => toMinorUnits('99999999999999999.99', 'usd')).toThrow(
      /too large/,
    );
  });
});
