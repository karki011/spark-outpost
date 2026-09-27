import { calcTotal, type OrderLine } from './total.ts';

export function cartSummary(lines: OrderLine[]): string {
  return `${lines.length} lines, ${calcTotal(lines)} cents`;
}
