import { roundCents } from './money.ts';
import { calcTotal, type Line } from './totals.ts';

export function averageOrder(orders: readonly (readonly Line[])[]): number {
  if (orders.length === 0) return 0;
  const sum = orders.reduce((total, lines) => total + calcTotal(lines), 0);
  return roundCents(sum / orders.length);
}
