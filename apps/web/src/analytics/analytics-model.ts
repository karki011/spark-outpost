import {
  categoryLabel,
  categorySchema,
  depthLabel,
  depthSchema,
  type DisagreementWinner,
  type OutcomeTally,
  type OutcomeVerdict,
} from '@spark-outpost/contracts';
import { formatCost } from '../usage/format.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
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

export function categoryName(key: string): string {
  const parsed = categorySchema.safeParse(key);
  return parsed.success ? categoryLabel(parsed.data) : 'Uncategorised';
}

export function depthName(key: string): string {
  const parsed = depthSchema.safeParse(key);
  if (!parsed.success) return key;
  const label = depthLabel(parsed.data);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const VERDICT_ORDER = ['good', 'mixed', 'unclear', 'bad', 'pending'] as const;

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

const WINNERS: Record<DisagreementWinner, string> = {
  jev: 'Jev',
  rules: 'Rule',
  tie: 'Too close to call',
  not_enough: 'Not enough runs',
};

export function winnerName(winner: DisagreementWinner): string {
  return WINNERS[winner];
}

const FIELDS: Record<string, string> = {
  model: 'Model',
  depth: 'Depth',
  effort: 'Effort',
  provider: 'Provider',
  risk: 'Risk',
};

export function fieldName(field: string): string {
  return FIELDS[field] ?? field;
}

export function pickName(field: string, value: string): string {
  return field === 'depth' ? depthName(value) : value;
}

export function goodShare(tally: Pick<OutcomeTally, 'good' | 'turns'>): string {
  return percent(tally.good, tally.turns);
}

export function tallyLine(tally: OutcomeTally): string {
  if (tally.turns === 0) return 'none';
  return `${plural(tally.turns, 'turn')}, ${goodShare(tally)} good, mean ${signedScore(tally.meanScore)}`;
}

export function duration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}
