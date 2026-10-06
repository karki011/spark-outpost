import type { DecisionLine } from '@spark-outpost/contracts';
import { csvCell } from './cost-csv.ts';

type Cell = string | number | boolean | null;
type Row = Partial<Record<(typeof COLUMNS)[number], Cell>>;

const COLUMNS = [
  'type',
  'at',
  'user_message_id',
  'run_id',
  'what',
  'status',
  'reason',
  'model',
  'tier',
  'runs',
  'sessions_opened',
  'sessions_resumed',
  'sessions_replaced',
  'cards',
  'minutes_waited',
  'carried_tokens',
  'cost_usd',
  'cache_write_usd',
  'cache_read_usd',
  'output_usd',
  'confidence',
  'band',
  'latency_ms',
] as const;

function rowOf(line: DecisionLine): Row {
  switch (line.type) {
    case 'meta':
      return {
        type: line.type,
        at: line.exportedAt,
        what: `app ${line.appVersion ?? 'unknown'}`,
        status: line.harness,
      };
    case 'turn':
      return {
        type: line.type,
        at: line.at,
        user_message_id: line.userMessageId,
        what: `${line.messageChars} characters`,
        status: line.status,
        tier: line.tiers.join(' '),
        runs: line.runs,
        sessions_opened: line.sessions.opened,
        sessions_resumed: line.sessions.resumed,
        sessions_replaced: line.sessions.replaced,
        cards: line.cards,
        minutes_waited: line.minutesWaited,
        cost_usd: line.cost.totalUsd,
        cache_write_usd: line.cost.cacheWriteUsd,
        cache_read_usd: line.cost.cacheReadUsd,
        output_usd: line.cost.outputUsd,
      };
    case 'run_end':
      return {
        type: line.type,
        user_message_id: line.userMessageId,
        run_id: line.runId,
        what: line.role,
        status: line.status,
        reason: line.error ?? line.endReason,
        tier: line.tier,
        cost_usd: line.cost.totalUsd,
        cache_write_usd: line.cost.cacheWriteUsd,
        cache_read_usd: line.cost.cacheReadUsd,
        output_usd: line.cost.outputUsd,
      };
    case 'session':
      return {
        type: line.type,
        at: line.at,
        user_message_id: line.userMessageId,
        run_id: line.runId,
        what: line.event,
        status: line.kept ? 'kept' : 'one-off',
        reason: line.reason,
        model: line.model,
        carried_tokens: line.carriedTokens,
        cache_write_usd: line.cacheWriteUsd,
      };
    case 'jev':
      return {
        type: line.type,
        at: line.at,
        user_message_id: line.userMessageId,
        run_id: line.runId,
        what: `${line.purpose}: ${line.questions.map((question) => question.id).join(' ')}`,
        status: line.status,
        reason: line.fallbackReason ?? line.applied,
        model: line.model,
        cost_usd: line.costUsd,
        confidence: line.confidence,
        band: line.band,
        latency_ms: line.latencyMs,
      };
    case 'card':
      return {
        type: line.type,
        at: line.requestedAt,
        user_message_id: line.userMessageId,
        run_id: line.runId,
        what: `${line.kind}: ${line.title}`,
        status: line.status,
        reason: line.reason ?? line.decidedBy,
        cards: line.shown ? 1 : 0,
        minutes_waited: line.minutesWaited,
      };
  }
}

export function decisionsCsv(lines: readonly DecisionLine[]): string {
  const rows = lines.map((line) => {
    const row = rowOf(line);
    return COLUMNS.map((column) => csvCell(row[column] ?? null)).join(',');
  });
  return `${[COLUMNS.join(','), ...rows].join('\r\n')}\r\n`;
}
