import { Prisma } from '../generated/prisma/client';

/**
 * Currencies whose smallest unit is the whole currency (ISO 4217 exponent 0).
 * Everything else is assumed to use 2 decimal places, which covers the
 * currencies this service currently charges in.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'isk',
  'jpy',
  'kmf',
  'krw',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

export function minorUnitExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 0 : 2;
}

/**
 * Converts a decimal major-unit amount (e.g. "199.00") into an integer number of
 * minor units (e.g. 19900 cents) using decimal arithmetic only. Throws instead of
 * silently rounding, so a sub-cent order total can never be under- or over-charged.
 */
export function toMinorUnits(
  amount: Prisma.Decimal | string,
  currency: string,
): number {
  const value = new Prisma.Decimal(amount);

  if (value.isNegative()) {
    throw new Error(`Cannot convert a negative amount to minor units: ${value}`);
  }

  const scaled = value.mul(new Prisma.Decimal(10).pow(minorUnitExponent(currency)));

  if (!scaled.isInteger()) {
    throw new Error(
      `Amount ${value} has more precision than ${currency.toUpperCase()} minor units allow`,
    );
  }

  const minorUnits = scaled.toNumber();
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error(`Amount ${value} is too large to represent in minor units`);
  }

  return minorUnits;
}
