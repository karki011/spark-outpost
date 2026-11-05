import {
  sessionEventSchema,
  type CardLine,
  type CostSplit,
  type JevBand,
  type JevLine,
  type RunEndLine,
  type SessionLine,
  type TurnLine,
} from '@spark-outpost/contracts';
import type { ModelPrice } from '../usage/prices.ts';
import { redactText } from './redact.ts';

export const ONE_OFF_SESSION = 'one-off session';
export const JEV_ACT_BAND = 0.8;
export const JEV_NO_BAND = 0.2;

export interface RunTokens {
  input: number | null;
  output: number | null;
  cachedRead: number | null;
  cachedWrite: number | null;
}

const UNPRICED: CostSplit = {
  totalUsd: null,
  inputUsd: null,
  cacheWriteUsd: null,
  cacheReadUsd: null,
  outputUsd: null,
  source: 'unpriced',
};

const usd = (tokens: number, perMillion: number) => Math.round(tokens * perMillion) / 1_000_000;

export function costSplit(tokens: RunTokens, price: ModelPrice | null): CostSplit {
  if (!price) return UNPRICED;
  const input = tokens.input ?? 0;
  const read = tokens.cachedRead ?? 0;
  const cached = price.cacheOutsideInput ? read : Math.min(read, input);
  const written = price.cacheOutsideInput ? (tokens.cachedWrite ?? 0) : 0;
  const uncached = price.cacheOutsideInput ? input : input - cached;
  const inputUsd = usd(uncached, price.inputPerMillion);
  const cacheWriteUsd = usd(written, price.cacheWritePerMillion ?? price.inputPerMillion);
  const cacheReadUsd = usd(cached, price.cachedInputPerMillion);
  const outputUsd = usd(tokens.output ?? 0, price.outputPerMillion);
  return {
    totalUsd: roundUsd(inputUsd + cacheWriteUsd + cacheReadUsd + outputUsd),
    inputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    outputUsd,
    source: 'estimated',
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const SPLIT_PARTS = ['totalUsd', 'inputUsd', 'cacheWriteUsd', 'cacheReadUsd', 'outputUsd'] as const;

export function addSplits(splits: readonly CostSplit[]): CostSplit {
  const priced = splits.filter((split) => split.source === 'estimated');
  if (priced.length === 0) return UNPRICED;
  const total = { ...UNPRICED, source: 'estimated' } as CostSplit;
  for (const part of SPLIT_PARTS) {
    total[part] = roundUsd(priced.reduce((sum, split) => sum + (split[part] ?? 0), 0));
  }
  return total;
}

type Body = Record<string, unknown>;

function record(value: unknown): Body | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Body)
    : null;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function askedQuestions(body: Body): JevLine['questions'] {
  const asked = record(body.questions) ?? record(record(body.asked)?.questions);
  if (!asked) return [];
  return Object.entries(asked).map(([id, question]) => ({
    id,
    type: text(record(question)?.type),
  }));
}

function stateChars(body: Body): number {
  const state = body.state ?? record(body.asked)?.state ?? null;
  return state === null ? 0 : JSON.stringify(state).length;
}

function confidenceOf(body: Body): number | null {
  return (
    finite(record(body.gate)?.confidence) ??
    finite(record(body.jev)?.confidence) ??
    finite(body.confidence)
  );
}

export function jevBand(confidence: number | null): JevBand | null {
  if (confidence === null) return null;
  if (confidence >= JEV_ACT_BAND) return 'act';
  return confidence <= JEV_NO_BAND ? 'no' : 'unsure';
}

function fallbackReason(status: string, applied: string | null, body: Body): string | null {
  if (status !== 'answered') return text(body.jevError) ?? text(body.error) ?? status;
  if (applied === 'rules') return 'under the act line';
  return applied === 'ask' ? 'unsure, asked' : null;
}

export interface AdviceRow {
  runId: string;
  childRunId: string | null;
  userMessageId: string;
  at: Date;
  purpose: string;
  status: string;
  inputTokens: number | null;
  costUsd: number | null;
  policyVersion: string | null;
  body: unknown;
}

export function jevLine(row: AdviceRow): JevLine {
  const body = record(row.body) ?? {};
  const confidence = confidenceOf(body);
  const applied = text(body.wouldApply) ?? text(body.source) ?? text(body.applied);
  return {
    type: 'jev',
    runId: row.runId,
    childRunId: row.childRunId,
    userMessageId: row.userMessageId,
    at: row.at.toISOString(),
    purpose: row.purpose,
    status: row.status,
    model: text(body.jevModel) ?? text(body.model),
    policyVersion: row.policyVersion,
    questions: askedQuestions(body),
    stateChars: stateChars(body),
    answers: body.answers ?? body.answer ?? null,
    confidence,
    band: jevBand(confidence),
    latencyMs: finite(body.latencyMs),
    inputTokens: row.inputTokens,
    costUsd: row.costUsd,
    applied,
    fallbackReason: fallbackReason(row.status, applied, body),
  };
}

export interface SessionEventRecord {
  runId: string | null;
  userMessageId: string | null;
  at: Date;
  body: unknown;
}

export interface SessionOpening {
  runId: string;
  userMessageId: string;
  at: Date;
  provider: string;
  model: string | null;
}

function recordedSession(row: SessionEventRecord): SessionLine | null {
  const event = sessionEventSchema.safeParse(row.body);
  if (!event.success) return null;
  return {
    type: 'session',
    runId: row.runId,
    userMessageId: row.userMessageId,
    at: row.at.toISOString(),
    ...event.data,
  };
}

function oneOffSession(row: SessionOpening): SessionLine {
  return {
    type: 'session',
    runId: row.runId,
    userMessageId: row.userMessageId,
    at: row.at.toISOString(),
    event: 'open',
    reason: ONE_OFF_SESSION,
    kept: false,
    provider: row.provider,
    agentKey: null,
    sessionId: null,
    model: row.model,
    carriedTokens: null,
    cacheWriteUsd: null,
  };
}

export function sessionLines(
  recorded: readonly SessionEventRecord[],
  openings: readonly SessionOpening[],
): SessionLine[] {
  const kept = recorded.flatMap((row) => recordedSession(row) ?? []);
  const keptRuns = new Set(kept.map((line) => line.runId));
  const oneOff = openings.filter((row) => !keptRuns.has(row.runId)).map(oneOffSession);
  return [...kept, ...oneOff].sort((a, b) => a.at.localeCompare(b.at));
}

const SHOWN_BY = new Set(['user', 'stop', 'timeout', 'recovery']);
const MS_PER_MINUTE = 60_000;

export interface ApprovalRow {
  runId: string;
  userMessageId: string;
  kind: string;
  title: string;
  status: string;
  reason: string | null;
  decidedBy: string | null;
  option: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

const minutes = (ms: number) => Math.round((ms / MS_PER_MINUTE) * 1000) / 1000;

export function cardLine(row: ApprovalRow, now: Date): CardLine {
  const shown = row.decidedBy === null || SHOWN_BY.has(row.decidedBy);
  const waited = (row.decidedAt ?? now).getTime() - row.createdAt.getTime();
  return {
    type: 'card',
    runId: row.runId,
    userMessageId: row.userMessageId,
    kind: row.kind,
    title: redactText(row.title),
    status: row.status,
    reason: row.reason === null ? null : redactText(row.reason),
    decidedBy: row.decidedBy,
    option: row.option,
    requestedAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    minutesWaited: shown ? minutes(Math.max(0, waited)) : 0,
    shown,
  };
}

export function coveredMinutes(cards: readonly CardLine[], now: Date): number {
  const spans = cards
    .filter((card) => card.shown)
    .map((card) => [Date.parse(card.requestedAt), Date.parse(card.decidedAt ?? now.toISOString())])
    .sort((a, b) => a[0]! - b[0]!);
  let covered = 0;
  let end = -Infinity;
  for (const [start, stop] of spans) {
    if (stop! <= end) continue;
    covered += stop! - Math.max(start!, end);
    end = stop!;
  }
  return minutes(covered);
}

export interface TurnFacts {
  userMessageId: string;
  at: Date;
  message: string;
  replyChars: number | null;
  status: string;
  includeText: boolean;
}

export interface TurnParts {
  runs: readonly (RunEndLine & { ranAgent: boolean })[];
  sessions: readonly SessionLine[];
  jev: readonly JevLine[];
  cards: readonly CardLine[];
  escalations: number;
}

const NOT_A_CALL = new Set(['not_connected', 'not_asked']);

export function turnLine(facts: TurnFacts, parts: TurnParts, now: Date): TurnLine {
  const sessionCount = (event: SessionLine['event']) =>
    parts.sessions.filter((session) => session.event === event).length;
  const agentRuns = parts.runs.filter((run) => run.ranAgent);
  return {
    type: 'turn',
    userMessageId: facts.userMessageId,
    at: facts.at.toISOString(),
    messageChars: facts.message.length,
    messageText: facts.includeText ? redactText(facts.message) : null,
    replyChars: facts.replyChars,
    status: facts.status,
    runs: agentRuns.length,
    sessions: {
      opened: sessionCount('open'),
      resumed: sessionCount('resume'),
      replaced: sessionCount('replace'),
      modelChanges: sessionCount('model_change'),
    },
    repeatRuns: agentRuns.filter((run) => (run.attempt ?? 1) > 1).length,
    escalations: parts.escalations,
    jevCalls: parts.jev.filter((call) => !NOT_A_CALL.has(call.status)).length,
    cards: parts.cards.filter((card) => card.shown).length,
    minutesWaited: coveredMinutes(parts.cards, now),
    tiers: [...new Set(agentRuns.flatMap((run) => (run.tier ? [run.tier] : [])))],
    cost: addSplits(parts.runs.map((run) => run.cost)),
  };
}
