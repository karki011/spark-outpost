import * as totals from './total.ts';

export function receiptTotalLine(lines: totals.OrderLine[]): string {
  return `TOTAL ${(totals.calcTotal(lines) / 100).toFixed(2)}`;
}
