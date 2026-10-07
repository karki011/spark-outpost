import {
  DECISION_EXPORT_VERSION,
  type CardLine,
  type DecisionLine,
  type HarnessSetting,
  type JevLine,
  type RunEndLine,
  type SessionLine,
} from '@spark-outpost/contracts';
import {
  cardLine,
  costSplit,
  jevLine,
  sessionLines,
  turnLine,
  type TurnParts,
} from '../audit/decision-lines.ts';
import { redactText } from '../audit/redact.ts';
import { cardFor } from '../model-cards/cards.ts';
import { cardPriceFor } from '../usage/prices.ts';
import type { Queryable } from './db.ts';
import { conversationSessionEvents } from './session-events.ts';

export interface DecisionExportOptions {
  appVersion: string | null;
  harness: HarnessSetting;
  now?: Date;
}

interface RunRow {
  id: string;
  user_message_id: string;
  parent_run_id: string | null;
  ran_agent: boolean;
  role: string | null;
  attempt: number | null;
  status: string;
  error: string | null;
  error_details: string | null;
  end_reason: string | null;
  provider: string;
  model: string | null;
  route_tier: string | null;
  escalated: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
}

interface TurnRow {
  id: string;
  created_at: Date;
  content: string;
  reply_chars: number | null;
  status: string | null;
}

type RunEnd = RunEndLine & { ranAgent: boolean; escalated: boolean };

function runEnd(row: RunRow): RunEnd {
  const model = row.model?.split('/')[0] ?? null;
  const tier = row.route_tier ?? (model ? cardFor({ id: model }, row.provider)?.tier : null);
  return {
    type: 'run_end',
    runId: row.id,
    userMessageId: row.user_message_id,
    role: row.role,
    attempt: row.attempt,
    status: row.status,
    endReason: row.end_reason,
    error: row.error === null ? null : redactText(row.error),
    errorDetails: row.error_details === null ? null : redactText(row.error_details),
    tier: tier ?? null,
    cost: costSplit(
      {
        input: row.input_tokens,
        output: row.output_tokens,
        cachedRead: row.cached_read_tokens,
        cachedWrite: row.cached_write_tokens,
      },
      cardPriceFor(row.provider, model),
    ),
    ranAgent: row.ran_agent,
    escalated: row.escalated,
  };
}

async function runEnds(db: Queryable, conversationId: string): Promise<RunEnd[]> {
  const { rows } = await db.query<RunRow>(
    `SELECT r.id, r.user_message_id, r.parent_run_id, r.role, r.attempt, r.status, r.error,
       r.error_details, r.provider, COALESCE(r.used_model, r.model) AS model,
       r.route->>'tier' AS route_tier, r.route ? 'escalation' AS escalated,
       (NOT EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id)
         OR EXISTS (SELECT 1 FROM run_protocol_log l WHERE l.run_id = r.id
              AND l.direction = 'to_agent' AND l.method = 'session/prompt')) AS ran_agent,
       (SELECT COALESCE(e.payload->>'code', e.payload->'outcome'->>'type', e.type)
          FROM run_events e
         WHERE e.run_id = r.id AND e.type IN ('RUN_FINISHED', 'RUN_ERROR')
         ORDER BY e.seq DESC LIMIT 1) AS end_reason,
       r.input_tokens, r.output_tokens, r.cached_read_tokens, r.cached_write_tokens
     FROM runs r WHERE r.conversation_id = $1 ORDER BY r.created_at, r.id`,
    [conversationId],
  );
  return rows.map(runEnd);
}

async function sessions(db: Queryable, conversationId: string): Promise<SessionLine[]> {
  const [recorded, openings] = await Promise.all([
    conversationSessionEvents(db, conversationId),
    db.query<{
      run_id: string;
      user_message_id: string;
      at: Date;
      provider: string;
      model: string | null;
    }>(
      `SELECT l.run_id, r.user_message_id, l.at, r.provider,
         COALESCE(r.used_model, r.model) AS model
       FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
       WHERE r.conversation_id = $1 AND l.direction = 'to_agent' AND l.kind = 'request'
         AND l.method = 'session/new'
       ORDER BY l.at, l.run_id, l.seq`,
      [conversationId],
    ),
  ]);
  return sessionLines(
    recorded,
    openings.rows.map((row) => ({
      runId: row.run_id,
      userMessageId: row.user_message_id,
      at: row.at,
      provider: row.provider,
      model: row.model,
    })),
  );
}

async function jevCalls(db: Queryable, conversationId: string): Promise<JevLine[]> {
  const { rows } = await db.query<{
    run_id: string;
    child_run_id: string | null;
    user_message_id: string;
    created_at: Date;
    purpose: string;
    jev_status: string;
    jev_input_tokens: number | null;
    cost_usd: number | null;
    policy_version: string | null;
    body: unknown;
  }>(
    `SELECT a.run_id, a.child_run_id, r.user_message_id, a.created_at, a.purpose, a.jev_status,
       a.jev_input_tokens, a.jev_cost_usd::float8 AS cost_usd, a.policy_version, a.body
     FROM run_advice a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 ORDER BY a.created_at, a.run_id`,
    [conversationId],
  );
  return rows.map((row) =>
    jevLine({
      runId: row.run_id,
      childRunId: row.child_run_id,
      userMessageId: row.user_message_id,
      at: row.created_at,
      purpose: row.purpose,
      status: row.jev_status,
      inputTokens: row.jev_input_tokens,
      costUsd: row.cost_usd,
      policyVersion: row.policy_version,
      body: row.body,
    }),
  );
}

async function cards(db: Queryable, conversationId: string, now: Date): Promise<CardLine[]> {
  const { rows } = await db.query<{
    run_id: string;
    user_message_id: string;
    kind: string;
    title: string;
    status: string;
    reason: string | null;
    decided_by: string | null;
    decision_option_id: string | null;
    created_at: Date;
    decided_at: Date | null;
  }>(
    `SELECT a.run_id, r.user_message_id, a.kind, a.title, a.status, a.reason, a.decided_by,
       a.decision_option_id, a.created_at, a.decided_at
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 ORDER BY a.created_at, a.id`,
    [conversationId],
  );
  return rows.map((row) =>
    cardLine(
      {
        runId: row.run_id,
        userMessageId: row.user_message_id,
        kind: row.kind,
        title: row.title,
        status: row.status,
        reason: row.reason,
        decidedBy: row.decided_by,
        option: row.decision_option_id,
        createdAt: row.created_at,
        decidedAt: row.decided_at,
      },
      now,
    ),
  );
}

async function turns(db: Queryable, conversationId: string): Promise<TurnRow[]> {
  const { rows } = await db.query<TurnRow>(
    `SELECT m.id, m.created_at, m.content,
       (SELECT sum(length(a.content))::int FROM messages a JOIN runs r ON r.id = a.run_id
         WHERE r.user_message_id = m.id AND a.role = 'assistant') AS reply_chars,
       (SELECT r.status FROM runs r WHERE r.user_message_id = m.id AND r.parent_run_id IS NULL
         ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS status
     FROM messages m
     WHERE m.conversation_id = $1 AND m.role = 'user'
       AND EXISTS (SELECT 1 FROM runs r WHERE r.user_message_id = m.id)
     ORDER BY m.created_at, m.id`,
    [conversationId],
  );
  return rows;
}

const ofTurn = <T extends { userMessageId: string | null }>(lines: readonly T[], id: string) =>
  lines.filter((line) => line.userMessageId === id);

export async function decisionLines(
  db: Queryable,
  conversationId: string,
  options: DecisionExportOptions,
): Promise<DecisionLine[]> {
  const now = options.now ?? new Date();
  const [messages, ends, sessionRows, jev, shown] = await Promise.all([
    turns(db, conversationId),
    runEnds(db, conversationId),
    sessions(db, conversationId),
    jevCalls(db, conversationId),
    cards(db, conversationId, now),
  ]);
  const turnLines = messages.map((message) => {
    const runs = ofTurn(ends, message.id);
    const parts: TurnParts = {
      runs,
      sessions: ofTurn(sessionRows, message.id),
      jev: ofTurn(jev, message.id),
      cards: ofTurn(shown, message.id),
      escalations: runs.filter((run) => run.escalated).length,
    };
    return turnLine(
      {
        userMessageId: message.id,
        at: message.created_at,
        message: message.content,
        replyChars: message.reply_chars,
        status: message.status ?? 'unknown',
        includeText: true,
      },
      parts,
      now,
    );
  });
  return [
    {
      type: 'meta',
      exportVersion: DECISION_EXPORT_VERSION,
      conversationId,
      exportedAt: now.toISOString(),
      appVersion: options.appVersion,
      harness: options.harness,
      messageText: 'redacted',
    },
    ...turnLines,
    ...ends.map(({ ranAgent: _ranAgent, escalated: _escalated, ...line }) => line),
    ...sessionRows,
    ...jev,
    ...shown,
  ];
}
