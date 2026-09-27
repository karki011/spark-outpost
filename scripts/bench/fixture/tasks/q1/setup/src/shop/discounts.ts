import { calcTotal, type OrderLine } from './total.ts';

export function bulkDiscount(lines: OrderLine[]): number {
  const total = calcTotal(lines);
  return total >= 100_00 ? Math.round(total * 0.05) : 0;
}
