import { calcTotal, type OrderLine } from './total.ts';

export function invoiceLines(lines: OrderLine[]): string[] {
  return [...lines.map((line) => `${line.sku} x${line.quantity}`), `= ${calcTotal(lines)}`];
}
