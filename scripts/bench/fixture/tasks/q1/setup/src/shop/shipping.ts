import { calcTotal, type OrderLine } from './total.ts';

export function shippingCents(lines: OrderLine[]): number {
  return calcTotal(lines) >= 50_00 ? 0 : 4_99;
}
