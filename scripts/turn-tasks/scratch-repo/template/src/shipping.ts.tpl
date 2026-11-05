import { FLAT_SHIPPING_CENTS, FREE_SHIPPING_CENTS } from './settings/region.ts';
import { calcTotal, type Line } from './totals.ts';

export function shippingCents(lines: readonly Line[]): number {
  if (lines.length === 0) return 0;
  return calcTotal(lines) >= FREE_SHIPPING_CENTS ? 0 : FLAT_SHIPPING_CENTS;
}
