import { openIssues, sessionHandoffPrompt, taskDiff } from './session-brief.ts';
import type { Queryable } from '../persistence/db.ts';
import { currentPieceList } from '../persistence/pieces.ts';
import { agreedPlanFor } from '../plans/plan-staleness.ts';
import type { MissedMessage } from '../providers/provider.ts';
import type { RunInput } from './run-input.ts';

const HISTORY_ROWS = 6;
const UNFINISHED_PIECES = new Set(['landed', 'skipped']);

async function latestTask(db: Queryable, conversationId: string) {
  const { rows } = await db.query<{ id: string; goal: string | null }>(
    `SELECT t.id,
       (SELECT m.content FROM runs r JOIN messages m ON m.id = r.user_message_id
         WHERE r.task_id = t.id AND r.parent_run_id IS NULL
         ORDER BY r.created_at LIMIT 1) AS goal
     FROM tasks t WHERE t.conversation_id = $1 ORDER BY t.created_at DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

async function recentMessages(db: Queryable, input: RunInput): Promise<MissedMessage[]> {
  const { rows } = await db.query<MissedMessage>(
    `SELECT role, content FROM (
       SELECT m.role, m.content, m.created_at, m.id FROM messages m
       WHERE m.conversation_id = $1
         AND m.created_at > COALESCE((SELECT pf.assistant_history_from FROM profiles pf
           WHERE pf.assistant_conversation_id = $1), '-infinity'::timestamptz)
         AND m.id <> (SELECT user_message_id FROM runs WHERE id = $2)
         AND m.created_at < (SELECT created_at FROM runs WHERE id = $2)
       ORDER BY m.created_at DESC, m.id DESC LIMIT $3
     ) recent ORDER BY created_at, id`,
    [input.identity.threadId, input.identity.runId, HISTORY_ROWS],
  );
  return rows;
}

async function chatTotals(
  db: Queryable,
  conversationId: string,
  runId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ turns: number; runs: number; tokens: string; cost: number }>(
    `SELECT count(DISTINCT user_message_id)::int AS turns, count(*)::int AS runs,
       COALESCE(sum(COALESCE(total_tokens, input_tokens + output_tokens)), 0)::text AS tokens,
       COALESCE(sum(cost_usd), 0)::float8 AS cost
     FROM runs WHERE conversation_id = $1
       AND user_message_id <> (SELECT user_message_id FROM runs WHERE id = $2)`,
    [conversationId, runId],
  );
  const totals = rows[0];
  if (!totals || totals.runs === 0) return null;
  return `Earlier turns: ${totals.turns}. Runs: ${totals.runs}. Tokens: ${totals.tokens}. Cost: $${totals.cost.toFixed(2)}.`;
}

async function openSubtasks(db: Queryable, taskId: string | null): Promise<string[]> {
  const list = taskId ? await currentPieceList(db, taskId) : null;
  if (!list) return [];
  return list.pieces
    .filter((piece) => !UNFINISHED_PIECES.has(piece.status))
    .map(
      (piece) =>
        `${piece.key} · ${piece.title}: ${piece.status}, check ${piece.check ?? 'not run'}`,
    );
}

export async function loadSessionHandoff(
  db: Queryable,
  input: RunInput,
  reason: string,
): Promise<string> {
  const conversationId = input.identity.threadId;
  const root = input.projectRoots[0];
  const task = await latestTask(db, conversationId);
  const [history, agreedPlan, diff, issues, subtasks, totals] = await Promise.all([
    recentMessages(db, input),
    agreedPlanFor(db, conversationId, root ?? null).catch(() => null),
    taskDiff(root),
    openIssues(db, task?.id ?? null),
    openSubtasks(db, task?.id ?? null),
    chatTotals(db, conversationId, input.identity.runId),
  ]);
  return sessionHandoffPrompt({
    reason,
    goal: task?.goal ?? history.find((turn) => turn.role === 'user')?.content ?? input.userRequest,
    history,
    agreedPlan,
    subtasks,
    changes: diff.files,
    openIssues: issues,
    totals,
  });
}

export async function missedMessages(
  db: Queryable,
  input: RunInput,
  since: Date,
  ownReply: string | null,
  agentKey: string,
): Promise<MissedMessage[]> {
  const { rows } = await db.query<MissedMessage & { reply_hash: string }>(
    `SELECT m.role, m.content, encode(sha256(convert_to(m.content, 'UTF8')), 'hex') AS reply_hash
     FROM messages m
     WHERE m.conversation_id = $1 AND m.created_at > $2
       AND m.id <> (SELECT user_message_id FROM runs WHERE id = $3)
       AND m.created_at < (SELECT created_at FROM runs WHERE id = $3)
       AND (m.run_id IS NULL OR m.run_id NOT IN (
         SELECT e.run_id FROM provider_session_events e
         JOIN provider_sessions s ON s.id = e.session_row_id
         WHERE s.conversation_id = $1 AND s.agent_key = $4 AND e.run_id IS NOT NULL))
     ORDER BY m.created_at, m.id`,
    [input.identity.threadId, since, input.identity.runId, agentKey],
  );
  return rows
    .filter((row) => !(row.role === 'assistant' && row.reply_hash === ownReply))
    .map(({ role, content }) => ({ role, content }));
}
