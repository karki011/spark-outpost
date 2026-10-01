import type { Db } from '../persistence/db.ts';
import { agreedPlanFor } from '../plans/plan-staleness.ts';
import { chatSummaryPrompt, openIssues, taskDiff } from '../orchestration/handoff.ts';
import type { RunInput } from '../workflow/run-input.ts';

async function latestTaskId(db: Db, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM tasks WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [conversationId],
  );
  return rows[0]?.id ?? null;
}

export async function buildChatSummary(
  db: Db,
  input: Pick<RunInput, 'identity' | 'projectRoots' | 'history'>,
): Promise<string> {
  const conversationId = input.identity.threadId;
  const root = input.projectRoots[0] ?? null;
  const [agreedPlan, diff, issues] = await Promise.all([
    agreedPlanFor(db, conversationId, root).catch(() => null),
    taskDiff(root ?? undefined),
    latestTaskId(db, conversationId).then((taskId) => openIssues(db, taskId)),
  ]);
  return chatSummaryPrompt({
    history: input.history,
    agreedPlan,
    changes: diff.files,
    patch: diff.patch,
    openIssues: issues,
  });
}
