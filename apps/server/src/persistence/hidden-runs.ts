import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface HiddenRun {
  title: string;
  archived: boolean;
  prompt: string;
  provider: string;
  model: string | null;
  effort: string | null;
}

export interface HiddenRunIds {
  conversationId: string;
  runId: string;
}

export async function insertHiddenRun(
  client: Queryable,
  workspaceId: string,
  run: HiddenRun,
): Promise<HiddenRunIds> {
  const conversationId = newId();
  const messageId = newId();
  const runId = newId();
  await client.query(
    `INSERT INTO conversations (id, workspace_id, title, kind, title_source, archived_at)
     VALUES ($1, $2, $3, 'digest', 'user', CASE WHEN $4 THEN now() END)`,
    [conversationId, workspaceId, run.title, run.archived],
  );
  await client.query(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
    [messageId, conversationId, run.prompt],
  );
  await client.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, effort, status,
       mode, role, picked_mode, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', 'chat', 'digest', 'chat', 'digest')`,
    [runId, conversationId, messageId, run.provider, run.model, run.effort],
  );
  await client.query(`INSERT INTO jobs (id, run_id, status) VALUES ($1, $2, 'queued')`, [
    newId(),
    runId,
  ]);
  return { conversationId, runId };
}

const STALE_RUNNING_MS = 10 * 60_000;
const UNFINISHED_AFTER_RUN_MS = 60_000;
const ENDED = ['failed', 'cancelled', 'outcome_unknown'];

export interface HiddenRunProgress {
  runStatus: string | null;
  runFinishedAt: Date | null;
  createdAt: Date;
}

export function abandonedRun(progress: HiddenRunProgress, now: Date): boolean {
  const ended = progress.runStatus !== null && ENDED.includes(progress.runStatus);
  const endedAt = progress.runFinishedAt ?? progress.createdAt;
  const abandoned = ended && now.getTime() - endedAt.getTime() > UNFINISHED_AFTER_RUN_MS;
  return abandoned || now.getTime() - progress.createdAt.getTime() > STALE_RUNNING_MS;
}
