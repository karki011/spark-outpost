import type { DecisionLine, HarnessSetting, TurnLine } from '@spark-outpost/contracts';
import { cardPriceFor } from '../../src/usage/prices.ts';
import { decisionLines } from '../../src/persistence/decision-audit.ts';
import type { TestDb } from '../support.ts';

const CHARS_PER_TOKEN = 4;

export interface ModelledCost {
  cacheWriteUsd: number;
  cacheReadUsd: number;
  outputUsd: number;
}

export interface ReplayRow {
  case: string;
  harness: HarnessSetting;
  turns: number;
  runs: number;
  runsLastTurn: number;
  opened: number;
  resumed: number;
  replaced: number;
  newSessionsLastTurn: number;
  modelChanges: number;
  repeatRuns: number;
  escalations: number;
  jevCalls: number;
  cards: number;
  tiers: string;
  promptTokens: number;
  cost: ModelledCost;
  replies: string[];
  seconds?: number;
}

export interface LedgerCounts {
  agentRuns: number;
  sessionsNew: number;
  sessionsResumed: number;
}

interface PromptRow {
  run_id: string;
  provider: string;
  model: string | null;
  session_id: string | null;
  prompt_bytes: number;
  reply_chars: number;
}

async function promptRows(t: TestDb, conversationId: string): Promise<PromptRow[]> {
  const { rows } = await t.db.query<PromptRow>(
    `SELECT r.id AS run_id, r.provider, COALESCE(r.used_model, r.model) AS model,
       (SELECT e.body->>'sessionId' FROM provider_session_events e
         WHERE e.run_id = r.id AND e.event <> 'close' ORDER BY e.at LIMIT 1) AS session_id,
       COALESCE((SELECT sum(l.size_bytes)::int FROM run_protocol_log l
         WHERE l.run_id = r.id AND l.direction = 'to_agent' AND l.kind = 'request'
           AND l.method = 'session/prompt'), 0) AS prompt_bytes,
       COALESCE((SELECT sum(l.size_bytes)::int FROM run_protocol_log l
         WHERE l.run_id = r.id AND l.direction = 'from_agent' AND l.method = 'session/update'
           AND l.payload->'params'->'update'->>'sessionUpdate' = 'agent_message_chunk'), 0)
         AS reply_chars
     FROM runs r WHERE r.conversation_id = $1 ORDER BY r.created_at, r.id`,
    [conversationId],
  );
  return rows;
}

const tokens = (bytes: number) => Math.ceil(bytes / CHARS_PER_TOKEN);
const usd = (count: number, perMillion: number) => (count * perMillion) / 1_000_000;

export function modelledCost(rows: readonly PromptRow[]): { cost: ModelledCost; sent: number } {
  const carried = new Map<string, number>();
  const cost = { cacheWriteUsd: 0, cacheReadUsd: 0, outputUsd: 0 };
  let sent = 0;
  for (const row of rows) {
    const price = cardPriceFor(row.provider, row.model?.split('/')[0] ?? null);
    const prompt = tokens(row.prompt_bytes);
    const reply = tokens(row.reply_chars);
    sent += prompt;
    const before = row.session_id ? (carried.get(row.session_id) ?? 0) : 0;
    if (row.session_id) carried.set(row.session_id, before + prompt + reply);
    if (!price) continue;
    cost.cacheWriteUsd += usd(prompt, price.cacheWritePerMillion ?? price.inputPerMillion);
    cost.cacheReadUsd += usd(before, price.cachedInputPerMillion);
    cost.outputUsd += usd(reply, price.outputPerMillion);
  }
  return { cost, sent };
}

export async function ledgerCounts(t: TestDb, conversationId: string): Promise<LedgerCounts> {
  const { rows } = await t.db.query<LedgerCounts>(
    `SELECT
       (SELECT count(*)::int FROM runs r WHERE r.conversation_id = $1
         AND EXISTS (SELECT 1 FROM run_protocol_log l WHERE l.run_id = r.id
           AND l.direction = 'to_agent' AND l.method = 'session/prompt')) AS "agentRuns",
       (SELECT count(*)::int FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
         WHERE r.conversation_id = $1 AND l.direction = 'to_agent' AND l.kind = 'request'
           AND l.method = 'session/new') AS "sessionsNew",
       (SELECT count(*)::int FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
         WHERE r.conversation_id = $1 AND l.direction = 'from_agent' AND l.kind = 'response'
           AND l.method IN ('session/resume', 'session/load')) AS "sessionsResumed"`,
    [conversationId],
  );
  return rows[0]!;
}

const sum = (turns: readonly TurnLine[], read: (turn: TurnLine) => number) =>
  turns.reduce((total, turn) => total + read(turn), 0);

export async function exportOf(
  t: TestDb,
  conversationId: string,
  harness: HarnessSetting,
): Promise<DecisionLine[]> {
  return decisionLines(t.db, conversationId, { appVersion: 'replay', harness });
}

export async function replayRow(
  t: TestDb,
  conversationId: string,
  name: string,
  harness: HarnessSetting,
  replies: string[],
): Promise<ReplayRow> {
  const lines = await exportOf(t, conversationId, harness);
  const turns = lines.filter((line): line is TurnLine => line.type === 'turn');
  const last = turns.at(-1)!;
  const modelled = modelledCost(await promptRows(t, conversationId));
  return {
    case: name,
    harness,
    turns: turns.length,
    runs: sum(turns, (turn) => turn.runs),
    runsLastTurn: last.runs,
    opened: sum(turns, (turn) => turn.sessions.opened),
    resumed: sum(turns, (turn) => turn.sessions.resumed),
    replaced: sum(turns, (turn) => turn.sessions.replaced),
    newSessionsLastTurn: last.sessions.opened + last.sessions.replaced,
    modelChanges: sum(turns, (turn) => turn.sessions.modelChanges),
    repeatRuns: sum(turns, (turn) => turn.repeatRuns),
    escalations: sum(turns, (turn) => turn.escalations),
    jevCalls: sum(turns, (turn) => turn.jevCalls),
    cards: sum(turns, (turn) => turn.cards),
    tiers: [...new Set(turns.flatMap((turn) => turn.tiers))].sort().join('+'),
    promptTokens: modelled.sent,
    cost: modelled.cost,
    replies,
  };
}

const cents = (value: number) => (value * 100).toFixed(3);

export function replayTable(rows: readonly ReplayRow[]): string {
  const header =
    '| Case | Harness | Turns | Runs | Runs, last turn | Sessions opened | resumed | replaced | New sessions, last turn | Model changes | Repeat runs of a role | Escalations | Jev calls | Cards | Tiers | Prompt tokens sent | Cache write ¢ | Cache read ¢ | Output ¢ | Seconds |';
  const rule = `|${' --- |'.repeat(20)}`;
  const body = rows.map((row) =>
    [
      row.case,
      row.harness,
      row.turns,
      row.runs,
      row.runsLastTurn,
      row.opened,
      row.resumed,
      row.replaced,
      row.newSessionsLastTurn,
      row.modelChanges,
      row.repeatRuns,
      row.escalations,
      row.jevCalls,
      row.cards,
      row.tiers || 'none',
      row.promptTokens,
      cents(row.cost.cacheWriteUsd),
      cents(row.cost.cacheReadUsd),
      cents(row.cost.outputUsd),
      row.seconds ?? '',
    ].join(' | '),
  );
  return [header, rule, ...body.map((line) => `| ${line} |`)].join('\n');
}
