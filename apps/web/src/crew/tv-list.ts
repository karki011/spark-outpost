import type { Orchestration, TotalCostSource } from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { countLabel } from '../ui/count-label.ts';
import { formatCost } from '../usage/format.ts';
import type { TvCast } from './conversation-crew.ts';
import { isBusy, modelLabel, type CrewAgent, type CrewState } from './crew-model.ts';
import { roleSubtitle, type TvAsk } from './tv-scene.ts';

type TvOutcome = 'passed' | 'failed' | 'stopped';

export interface TvRow {
  key: string;
  runId: string;
  name: string;
  role: string | null;
  provider: string;
  model: string;
  state: CrewState;
  line: string;
  tokens: number | null;
  costUsd: number | null;
  costSource: TotalCostSource | null;
  toolCalls: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  ask: TvAsk | null;
  lead: boolean;
  order: number;
}

export interface TvRows {
  running: TvRow[];
  finished: TvRow[];
}

const FINISHED: ReadonlySet<CrewState> = new Set(['done', 'failed', 'stopped']);

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function wallMs(startedAt: number | null, finishedAt: number | null, fallback: number | null) {
  if (startedAt !== null && finishedAt !== null && finishedAt >= startedAt) {
    return finishedAt - startedAt;
  }
  return fallback;
}

interface RowTimes {
  toolCalls: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

function row(agent: CrewAgent, order: number, times: RowTimes, ask: TvAsk | undefined): TvRow {
  const startedAt = time(times.startedAt);
  const finishedAt = time(times.finishedAt);
  return {
    key: agent.id,
    runId: agent.id,
    name: agent.name,
    role: roleSubtitle(agent),
    provider: agent.provider,
    model: modelLabel(agent),
    state: agent.state,
    line: agent.line,
    tokens: agent.tokens,
    costUsd: agent.costUsd,
    costSource: agent.costSource,
    toolCalls: times.toolCalls,
    startedAt,
    finishedAt,
    durationMs: wallMs(startedAt, finishedAt, agent.durationMs),
    ask: ask ?? null,
    lead: order === 0,
    order,
  };
}

export function tvListRows(cast: TvCast, asks: Record<string, TvAsk>): TvRows {
  const { run, lead, sparks } = cast;
  const rows = [
    row(
      lead,
      0,
      { toolCalls: null, startedAt: run.startedAt, finishedAt: run.finishedAt },
      asks[lead.id],
    ),
    ...sparks.map(({ member, agent }, index) => row(agent, index + 1, member, asks[agent.id])),
  ];
  const running = rows.filter((item) => !FINISHED.has(item.state));
  const finished = rows.filter((item) => FINISHED.has(item.state));
  return { running: sortRunning(running), finished: sortFinished(finished) };
}

export function turnState(status: Orchestration['status']): CrewState {
  if (status === 'succeeded') return 'done';
  if (status === 'cancelled') return 'stopped';
  return 'failed';
}

export function needsYou(item: Pick<TvRow, 'ask' | 'state'>): boolean {
  return item.ask !== null || item.state === 'waiting';
}

function rank(item: TvRow): number {
  if (needsYou(item)) return 0;
  if (item.state === 'queued') return 2;
  return 1;
}

function nullsLast(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

export function sortRunning(rows: readonly TvRow[]): TvRow[] {
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.lead) - Number(a.lead) ||
      nullsLast(a.startedAt, b.startedAt, 1) ||
      a.order - b.order,
  );
}

export function sortFinished(rows: readonly TvRow[]): TvRow[] {
  return [...rows].sort((a, b) => nullsLast(a.finishedAt, b.finishedAt, -1) || a.order - b.order);
}

export function outcomeOf(state: CrewState): TvOutcome {
  if (state === 'done') return 'passed';
  if (state === 'stopped') return 'stopped';
  return 'failed';
}

const OUTCOME_WORDS: Record<TvOutcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
};

export function outcomeWord(outcome: TvOutcome): string {
  return OUTCOME_WORDS[outcome];
}

export function rowUsage(item: TvRow): string[] {
  const parts: string[] = [];
  if (item.tokens !== null) parts.push(`${formatTokens(item.tokens)} tokens`);
  if (item.costUsd !== null) parts.push(formatCost(item.costUsd, item.costSource));
  if (item.toolCalls) {
    parts.push(countLabel(item.toolCalls, 'tool use'));
  }
  return parts;
}

export function activityText(item: TvRow): string {
  const text = item.line.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function rowIsLive(item: TvRow): boolean {
  return isBusy(item.state) || item.state === 'waiting';
}
