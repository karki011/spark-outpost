import type { AuditRunSummary, ProtocolLogEntry } from '@spark-outpost/contracts';

export interface AuditTurn {
  userMessageId: string;
  runs: AuditRunSummary[];
}

export function auditTurns(runs: readonly AuditRunSummary[]): AuditTurn[] {
  const turns: AuditTurn[] = [];
  for (const run of runs) {
    const turn = turns.find((candidate) => candidate.userMessageId === run.userMessageId);
    if (turn) turn.runs.push(run);
    else turns.push({ userMessageId: run.userMessageId, runs: [run] });
  }
  return turns;
}

export interface Span {
  left: number;
  width: number;
}

export interface WaitSpan extends Span {
  auto: boolean;
}

export interface WaterfallBar extends Span {
  run: AuditRunSummary;
  live: boolean;
  seconds: number;
}

export interface Waterfall {
  startedAt: number;
  wallMs: number;
  waitMs: number;
  scaleSeconds: number;
  ticks: number[];
  bars: WaterfallBar[];
  waits: WaitSpan[];
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'awaiting_approval']);

export function isLive(run: Pick<AuditRunSummary, 'status'>): boolean {
  return LIVE_STATUSES.has(run.status);
}

function ms(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso);
}

function tickStep(scaleSeconds: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((step) => scaleSeconds / step <= 6) ?? 3600;
}

function percent(value: number, scaleMs: number): number {
  return Math.min(100, Math.max(0, (value / scaleMs) * 100));
}

export function waterfall(turn: AuditTurn, now: number): Waterfall {
  const spans = turn.runs.map((run) => {
    const start = ms(run.startedAt) ?? ms(run.createdAt)!;
    const end = ms(run.finishedAt) ?? (isLive(run) ? now : start);
    return { run, start, end: Math.max(start, end) };
  });
  const startedAt = Math.min(...spans.map((span) => span.start));
  const finishedAt = Math.max(...spans.map((span) => span.end));
  const wallMs = finishedAt - startedAt;
  const scaleSeconds = Math.max(1, Math.ceil(wallMs / 1000));
  const step = tickStep(scaleSeconds);
  const scale = Math.ceil(scaleSeconds / step) * step;
  const scaleMs = scale * 1000;
  const waitSpans = turn.runs.flatMap((run) =>
    run.approvalWaits.map((wait) => {
      const start = ms(wait.start)!;
      const end = ms(wait.end) ?? now;
      return { start, end: Math.max(start, end), auto: wait.auto ?? false };
    }),
  );
  return {
    startedAt,
    wallMs,
    waitMs: waitSpans.reduce((total, span) => total + (span.end - span.start), 0),
    scaleSeconds: scale,
    ticks: Array.from({ length: scale / step + 1 }, (_, index) => index * step),
    bars: spans.map(({ run, start, end }) => ({
      run,
      live: isLive(run),
      seconds: (end - start) / 1000,
      left: percent(start - startedAt, scaleMs),
      width: Math.max(0.6, percent(end - start, scaleMs)),
    })),
    waits: waitSpans.map((span) => ({
      left: percent(span.start - startedAt, scaleMs),
      width: Math.max(0.6, percent(span.end - span.start, scaleMs)),
      auto: span.auto,
    })),
  };
}

export function formatDuration(msValue: number | null): string {
  if (msValue === null) return '—';
  const seconds = msValue / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function tickLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m${String(rest).padStart(2, '0')}` : `${minutes}m`;
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  const parts = [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) =>
    String(part).padStart(2, '0'),
  );
  return `${parts.join(':')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function updateSummary(payload: Record<string, unknown>): string | null {
  const update = record(record(payload.params)?.update);
  const kind = text(update?.sessionUpdate);
  if (!update || !kind) return null;
  const title = text(update.title);
  return title ? `${kind} · ${title}` : kind;
}

const CHECK_CAUSES: Record<string, string> = {
  baseline: 'already failing before this change',
  unknown: "failed before this change or can't tell",
  timeout: 'could not finish in time',
  environment: 'could not run',
};

export function entrySummary(entry: ProtocolLogEntry): string {
  const payload = record(entry.payload) ?? {};
  if (entry.kind === 'stderr') return text(payload.text) ?? 'stderr output';
  if (entry.kind === 'check') {
    const outcome = text(payload.outcome)?.replace(/_/g, ' ') ?? 'ran';
    if (entry.method === 'deps/prepare') {
      const lockfile = payload.lockfileMatched === false ? ' · lockfile differed' : '';
      return `dependencies · ${text(payload.method) ?? 'prepared'}${lockfile} · ${outcome}`;
    }
    const cause = CHECK_CAUSES[text(payload.cause) ?? ''];
    return `${text(payload.command) ?? 'check'} · ${cause ?? outcome}`;
  }
  if (entry.truncated) return `${entry.method ?? entry.kind} · truncated`;
  if (entry.kind === 'error') {
    const message = text(record(payload.error)?.message);
    return `${entry.method ?? 'error'} failed${message ? ` · ${message}` : ''}`;
  }
  if (entry.method === 'session/update') return updateSummary(payload) ?? entry.method;
  if (entry.kind === 'response') return `${entry.method ?? 'response'} · reply`;
  return entry.method ?? entry.kind;
}

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'plain';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

export const JSON_TOKEN_LIMIT = 16_000;

export function jsonTokens(value: unknown, limit = Infinity): JsonToken[] {
  const full = JSON.stringify(value, null, 2) ?? 'undefined';
  const cut = full.length > limit ? full.lastIndexOf('\n', limit) : -1;
  const source = cut > 0 ? full.slice(0, cut) : full;
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of source.matchAll(JSON_TOKEN)) {
    const index = match.index;
    if (index > last) tokens.push({ kind: 'plain', text: source.slice(last, index) });
    const [whole, quoted, colon, number, literal] = match;
    if (quoted !== undefined) {
      tokens.push({ kind: colon ? 'key' : 'string', text: quoted });
      if (colon) tokens.push({ kind: 'plain', text: colon });
    } else if (number !== undefined) {
      tokens.push({ kind: 'number', text: number });
    } else if (literal !== undefined) {
      tokens.push({ kind: 'literal', text: literal });
    }
    last = index + whole.length;
  }
  const rest = source.slice(last) + (cut > 0 ? full.slice(cut) : '');
  if (rest) tokens.push({ kind: 'plain', text: rest });
  return tokens;
}
