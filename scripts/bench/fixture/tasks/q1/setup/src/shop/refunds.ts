import { calcTotal as orderTotal, type OrderLine } from './total.ts';

export function refundCents(lines: OrderLine[], returned: OrderLine[]): number {
  return Math.min(orderTotal(lines), orderTotal(returned));
}
