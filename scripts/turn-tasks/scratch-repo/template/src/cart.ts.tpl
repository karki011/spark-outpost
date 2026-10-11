import { applyDiscount } from './discount.ts';
import { calcTotal, type Line } from './totals.ts';

export function cartTotal(lines: readonly Line[], discountPercent = 0): number {
  return applyDiscount(calcTotal(lines), discountPercent);
}
