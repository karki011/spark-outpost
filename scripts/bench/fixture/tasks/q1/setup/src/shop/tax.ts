import { calcTotal, type OrderLine } from './total.ts';

export function salesTax(lines: OrderLine[], rate: number): number {
  return Math.round(calcTotal(lines) * rate);
}
