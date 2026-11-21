import type { Db } from '../persistence/db.ts';
import { agreedPlanFor } from '../plans/plan-staleness.ts';
import {
  CHAT_REQUESTS,
  chatSummaryPrompt,
  openIssues,
  taskDiff,
  type DatedRequest,
} from '../workflow/session-brief.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { chatIdentifiers } from './identifiers.ts';
import { loadLiveState } from './live-state.ts';

const REQUEST_CHARS = 300;
const NO_REQUESTS = { requests: [], total: 0 };

async function latestTaskId(db: Db, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM tasks WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [conversationId],
  );
  return rows[0]?.id ?? null;
}

async function datedRequests(db: Db, conversationId: string, runId: string) {
  const { rows } = await db.query<DatedRequest & { total: number }>(
    `SELECT left(m.content, $3) AS content, to_char(m.created_at, 'YYYY-MM-DD') AS "sentOn",
       count(*) OVER ()::int AS total
     FROM messages m
     WHERE m.conversation_id = $1 AND m.role = 'user' AND btrim(m.content) <> ''
       AND m.id <> (SELECT user_message_id FROM runs WHERE id = $2)
       AND m.created_at < (SELECT created_at FROM runs WHERE id = $2)
       AND NOT EXISTS (
         SELECT 1 FROM runs hr
         WHERE hr.user_message_id = m.id AND hr.parent_run_id IS NULL
           AND hr.source IN ('assistant', 'workflow', 'spark_rule', 'pr_follow_up', 'agent_cycle',
             'chat')
       )
       AND m.created_at > COALESCE((SELECT pf.assistant_history_from FROM profiles pf
         WHERE pf.assistant_conversation_id = $1), '-infinity'::timestamptz)
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $4`,
    [conversationId, runId, REQUEST_CHARS, CHAT_REQUESTS],
  );
  const requests = rows.map(({ content, sentOn }) => ({ content, sentOn })).reverse();
  return { requests, total: rows[0]?.total ?? 0 };
}

export async function buildChatSummary(
  db: Db,
  input: Pick<RunInput, 'identity' | 'projectRoots' | 'history'>,
): Promise<string> {
  const conversationId = input.identity.threadId;
  const root = input.projectRoots[0] ?? null;
  const [agreedPlan, diff, issues, identifiers, dated, liveState] = await Promise.all([
    agreedPlanFor(db, conversationId, root).catch(() => null),
    taskDiff(root ?? undefined),
    latestTaskId(db, conversationId).then((taskId) => openIssues(db, taskId)),
    chatIdentifiers(db, input),
    datedRequests(db, conversationId, input.identity.runId).catch(() => NO_REQUESTS),
    loadLiveState(db, conversationId, root, []),
  ]);
  return chatSummaryPrompt({
    history: input.history,
    requests: dated.requests,
    requestTotal: dated.total,
    liveState,
    agreedPlan,
    changes: diff.files,
    patch: diff.patch,
    openIssues: issues,
    identifiers,
  });
}
