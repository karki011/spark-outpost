import { rateLimitName, type TerminalMeasure } from '@spark-outpost/contracts';
import { formatTokens } from '../../chat/composer/model-options.ts';

export interface LimitRow {
  key: string;
  name: string;
  value: string;
  detail: string | null;
}

function percentText(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

export function resetWhen(at: number, now: number, clock: (at: number) => string): string {
  const day = new Date(at);
  if (day.toDateString() === new Date(now).toDateString()) return clock(at);
  const date = day.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${date} ${clock(at)}`;
}

export function limitRows(measure: TerminalMeasure, clock: (at: number) => string): LimitRow[] {
  const rows: LimitRow[] = measure.rateLimits.map((limit) => {
    const resets = limit.resetsAt === null ? Number.NaN : Date.parse(limit.resetsAt);
    return {
      key: limit.kind,
      name: rateLimitName(limit.kind),
      value: `${percentText(limit.percentUsed)} used`,
      detail: Number.isFinite(resets) ? `resets ${clock(resets)}` : null,
    };
  });
  const context = measure.context;
  if (context && context.percent !== null)
    rows.push({
      key: 'context',
      name: 'Context',
      value: `${percentText(context.percent)} full`,
      detail:
        context.tokens === null
          ? null
          : `${formatTokens(context.tokens)} of ${formatTokens(context.window)} tokens`,
    });
  return rows;
}
