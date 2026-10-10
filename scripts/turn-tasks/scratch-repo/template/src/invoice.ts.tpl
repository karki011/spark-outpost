import { roundCents } from './money.ts';
import { DEFAULT_TAX_RATE } from './settings/region.ts';
import { calcTotal, type Line } from './totals.ts';

export function invoiceTotal(lines: readonly Line[], taxRate = DEFAULT_TAX_RATE): number {
  const net = calcTotal(lines);
  return net + roundCents(net * taxRate);
}
