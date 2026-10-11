import { calcTotal, type Line } from './totals.ts';

export function refundCents(lines: readonly Line[], returnedSkus: readonly string[]): number {
  return calcTotal(lines.filter((line) => returnedSkus.includes(line.sku)));
}
