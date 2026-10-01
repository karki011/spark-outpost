import {
  LAW_ESTIMATE_HIGH,
  LAW_ESTIMATE_LOW,
  LAW_ESTIMATE_MIN_RUNS,
  LAW_ESTIMATE_WINDOW,
  LAW_PAD_MAX,
  LAW_PAD_MIN_RUNS,
  LAW_ROUGH_COST_PAD,
  LAW_ROUGH_MINUTES,
  LAW_ROUGH_RANGE,
} from '../advisor/policy.ts';
import { usd } from '../orchestration/cache-switch.ts';

export interface TaskKey {
  kind: string;
  size: number;
  model: string | null;
}

export interface PastRun extends TaskKey {
  minutes: number;
  usd: number;
  baseMinutes: number | null;
  baseUsd: number | null;
}

export interface Span {
  typical: number;
  low: number;
  high: number;
}

export interface TaskEstimate extends TaskKey {
  source: 'history' | 'rough';
  runs: number;
  base: { minutes: Span; usd: Span };
  minutes: Span;
  usd: Span;
  padding: { minutes: number; usd: number };
  text: string;
}

export function quantile(values: readonly number[], at: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * at;
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (position - below);
}

function spanOf(values: readonly number[]): Span {
  return {
    typical: quantile(values, 0.5),
    low: quantile(values, LAW_ESTIMATE_LOW),
    high: quantile(values, LAW_ESTIMATE_HIGH),
  };
}

function scaled(span: Span, factor: number): Span {
  return { typical: span.typical * factor, low: span.low * factor, high: span.high * factor };
}

export function similarRuns(history: readonly PastRun[], key: TaskKey): PastRun[] {
  const sameKind = history.filter((run) => run.kind === key.kind && run.size === key.size);
  const sameModel = sameKind.filter((run) => run.model === key.model);
  const pool = sameModel.length >= LAW_ESTIMATE_MIN_RUNS ? sameModel : sameKind;
  return pool.slice(0, LAW_ESTIMATE_WINDOW);
}

export function paddingFrom(ratios: readonly number[]): number {
  const usable = ratios.filter((ratio) => Number.isFinite(ratio) && ratio > 0);
  if (usable.length < LAW_PAD_MIN_RUNS) return 1;
  return Math.min(LAW_PAD_MAX, Math.max(1, quantile(usable, 0.5)));
}

function paddings(history: readonly PastRun[]): { minutes: number; usd: number } {
  const recent = history.slice(0, LAW_ESTIMATE_WINDOW);
  return {
    minutes: paddingFrom(
      recent.flatMap((run) => (run.baseMinutes ? [run.minutes / run.baseMinutes] : [])),
    ),
    usd: paddingFrom(recent.flatMap((run) => (run.baseUsd ? [run.usd / run.baseUsd] : []))),
  };
}

function roughSpan(typical: number): Span {
  return { typical, low: typical * LAW_ROUGH_RANGE[0], high: typical * LAW_ROUGH_RANGE[1] };
}

export function minutesText(minutes: number): string {
  if (minutes < 1) return '<1 min';
  return `${Math.round(minutes)} min`;
}

function rangeText(span: Span, format: (value: number) => string): string {
  const low = format(span.low);
  const high = format(span.high);
  return low === high ? low : `${low}–${high}`;
}

function minuteRange(span: Span): string {
  if (span.high < 1) return '<1 min';
  return `${rangeText(span, (value) => String(Math.max(1, Math.round(value))))} min`;
}

function estimateText(estimate: Omit<TaskEstimate, 'text'>): string {
  const typical = `~${minutesText(estimate.minutes.typical)}, ~${usd(estimate.usd.typical)}`;
  const range = `${minuteRange(estimate.minutes)}, ${rangeText(estimate.usd, usd)}`;
  const padded =
    estimate.padding.minutes > 1 ? `, padded ×${estimate.padding.minutes.toFixed(1)}` : '';
  if (estimate.source === 'rough') {
    return `Rough estimate: ${typical} (${range}${padded}); fewer than ${LAW_ESTIMATE_MIN_RUNS} similar runs to learn from yet`;
  }
  return `Usually ${typical} for a task like this (${range} over ${estimate.runs} similar runs${padded})`;
}

export function estimateTask(
  key: TaskKey,
  history: readonly PastRun[],
  roughUsd: number | null,
): TaskEstimate {
  const similar = similarRuns(history, key);
  const padding = paddings(history);
  const fromHistory = similar.length >= LAW_ESTIMATE_MIN_RUNS;
  const level = Math.min(5, Math.max(1, Math.round(key.size))) - 1;
  const base = fromHistory
    ? {
        minutes: spanOf(similar.map((run) => run.minutes)),
        usd: spanOf(similar.map((run) => run.usd)),
      }
    : {
        minutes: roughSpan(LAW_ROUGH_MINUTES[level]!),
        usd: roughSpan((roughUsd ?? 0) * LAW_ROUGH_COST_PAD),
      };
  const estimate = {
    ...key,
    source: fromHistory ? ('history' as const) : ('rough' as const),
    runs: similar.length,
    base,
    minutes: scaled(base.minutes, padding.minutes),
    usd: scaled(base.usd, padding.usd),
    padding,
  };
  return { ...estimate, text: estimateText(estimate) };
}
