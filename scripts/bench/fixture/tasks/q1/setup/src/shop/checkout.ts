import { calcTotal, type OrderLine } from './total.ts';

export function amountDue(lines: OrderLine[], paidCents: number): number {
  return Math.max(0, calcTotal(lines) - paidCents);
}
