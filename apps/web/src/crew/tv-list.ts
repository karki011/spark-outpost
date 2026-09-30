import {
  isTerminalRunStatus,
  type ConversationDetail,
  type Orchestration,
  type TotalCostSource,
} from '@spark-outpost/contracts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { countLabel } from '../ui/count-label.ts';
import { formatCost } from '../usage/format.ts';
import { isBusy, isDispatcher, modelLabel, type CrewAgent, type CrewState } from './crew-model.ts';
import { jevAgent, runAgent } from './crew-projection.ts';
import { pieceLabels } from './piece-labels.ts';
import { roleSubtitle, type TvAsk } from './tv-scene.ts';

type TvOutcome = 'passed' | 'failed' | 'stopped';

export interface TvRow {
  key: string;
  runId: string;
  agentId: string;
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
  dispatcher: boolean;
  piece: string | null;
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

function row(
  agent: CrewAgent,
  extra: Pick<
    TvRow,
    'key' | 'runId' | 'toolCalls' | 'startedAt' | 'finishedAt' | 'order' | 'piece'
  > & {
    ask: TvAsk | undefined;
  },
): TvRow {
  return {
    key: extra.key,
    runId: extra.runId,
    agentId: agent.id,
    name: agent.name,
    role: roleSubtitle(agent),
    provider: agent.provider,
    model: modelLabel(agent),
    state: agent.state,
    line: agent.line,
    tokens: agent.tokens,
    costUsd: agent.costUsd,
    costSource: agent.costSource,
    toolCalls: extra.toolCalls,
    startedAt: extra.startedAt,
    finishedAt: extra.finishedAt,
    durationMs: wallMs(extra.startedAt, extra.finishedAt, agent.durationMs),
    ask: extra.ask ?? null,
    dispatcher: agent.role === 'jev',
    piece: extra.piece,
    order: extra.order,
  };
}

export function tvListRows(
  detail: ConversationDetail | undefined,
  orchestration: Orchestration,
  agents: readonly CrewAgent[],
  asks: Record<string, TvAsk>,
): TvRows {
  const activity = detail?.activity ?? {};
  const pieces = pieceLabels(orchestration);
  const crew = orchestration.crew.map((member, index) =>
    row(runAgent(member, orchestration, activity[member.runId] ?? []), {
      key: member.runId,
      runId: member.runId,
      toolCalls: member.toolCalls,
      startedAt: time(member.startedAt),
      finishedAt: time(member.finishedAt),
      order: index + 1,
      piece: pieces.get(member.runId) ?? null,
      ask: asks[member.runId],
    }),
  );
  const parent = detail?.runs.find((run) => run.id === orchestration.runId);
  const turnActive = !isTerminalRunStatus(orchestration.status);
  const jevBase = agents.find(isDispatcher) ?? jevAgent(orchestration, []);
  const jev = row(
    { ...jevBase, state: turnActive ? jevBase.state : turnState(orchestration.status) },
    {
      key: `jev:${orchestration.runId}`,
      runId: orchestration.runId,
      toolCalls: null,
      startedAt: time(parent?.startedAt),
      finishedAt: turnActive ? null : time(parent?.finishedAt),
      order: 0,
      piece: null,
      ask: asks.jev,
    },
  );
  const running: TvRow[] = [];
  const finished: TvRow[] = [];
  if (turnActive) running.push(jev);
  else finished.push(jev);
  for (const item of crew) (FINISHED.has(item.state) ? finished : running).push(item);
  return { running: sortRunning(running), finished: sortFinished(finished) };
}

function turnState(status: Orchestration['status']): CrewState {
  if (status === 'succeeded') return 'done';
  if (status === 'cancelled') return 'stopped';
  return 'failed';
}

export function needsYou(item: Pick<TvRow, 'ask' | 'state' | 'dispatcher'>): boolean {
  return item.ask !== null || (item.state === 'waiting' && !item.dispatcher);
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
      Number(b.dispatcher) - Number(a.dispatcher) ||
      nullsLast(a.startedAt, b.startedAt, 1) ||
      a.order - b.order,
  );
}

export function sortFinished(rows: readonly TvRow[]): TvRow[] {
  return [...rows].sort((a, b) => nullsLast(a.finishedAt, b.finishedAt, -1) || a.order - b.order);
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
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
