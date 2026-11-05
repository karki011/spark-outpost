import { formatCents } from './money.ts';
import { calcTotal, type Line } from './totals.ts';

export function receiptLine(lines: readonly Line[]): string {
  return `Total ${formatCents(calcTotal(lines))}`;
}
