import { roundCents } from './money.ts';

export function applyDiscount(cents: number, percent: number): number {
  if (percent <= 0) return cents;
  if (percent >= 100) return 0;
  return roundCents(cents - (cents * percent) / 10);
}
