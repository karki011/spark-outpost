import type { OutcomeVerdict, VerdictCounts } from '@spark-outpost/contracts';
import { formatCost } from '../usage/format.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortMonth(date: string): string {
  return MONTHS[Number(date.slice(5, 7)) - 1]!;
}

export function shortDate(date: string): string {
  return `${shortMonth(date)} ${Number(date.slice(8, 10))}`;
}

export function ratedTurns(counts: Pick<VerdictCounts, RatedVerdict>): number {
  return counts.good + counts.bad + counts.mixed + counts.unclear;
}

export function percent(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((100 * part) / whole)}%`;
}

export function ratePercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function usd(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : formatCost(value);
}

export function signedScore(score: number | null): string {
  if (score === null) return '—';
  const rounded = score.toFixed(2);
  return score > 0 ? `+${rounded}` : rounded;
}

export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : many}`;
}

export const RATED_VERDICTS = ['good', 'mixed', 'unclear', 'bad'] as const;

export type RatedVerdict = (typeof RATED_VERDICTS)[number];

const VERDICT_NAMES: Record<string, string> = {
  good: 'Good',
  mixed: 'Mixed',
  unclear: 'Unclear',
  bad: 'Bad',
  pending: 'No outcome yet',
};

export function verdictName(key: OutcomeVerdict | 'pending' | string): string {
  return VERDICT_NAMES[key] ?? key;
}
