import { calcTotal, type OrderLine } from './total.ts';
import { salesTax } from './tax.ts';

export function orderSummary(lines: OrderLine[]) {
  const subtotal = calcTotal(lines);
  return { subtotal, tax: salesTax(lines, 0.2), grand: subtotal + salesTax(lines, 0.2) };
}
