import { digestModelFor } from '../digest/service.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { insertHiddenRun } from '../persistence/hidden-runs.ts';
import { newId } from '../persistence/ids.ts';
import type { Lease } from '../persistence/jobs.ts';
import { getSetupState } from '../persistence/setup.ts';
import type { TurnDeps } from '../workflow/agent-turn.ts';
import { executeChildRun } from '../workflow/execute-run.ts';

export interface NotesCompletion {
  text: string;
  runId: string | null;
}

export interface NotesModel {
  available(): Promise<boolean>;
  complete(prompt: string): Promise<NotesCompletion>;
}

export class NotesModelError extends Error {}

const MEETING_NOTES_TITLE = 'Meeting notes';
const POLL_MS = 400;
const REPLY_GRACE_MS = 10_000;
const FAILED = 'The model could not write the notes. Write again.';

export async function isMeetingNotesRun(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM runs r JOIN conversations c ON c.id = r.conversation_id
      WHERE r.id = $1 AND r.role = 'digest' AND c.kind = 'digest' AND c.title = $2`,
    [runId, MEETING_NOTES_TITLE],
  );
  return rows.length > 0;
}

export async function executeMeetingNotesRun(deps: TurnDeps, lease: Lease): Promise<void> {
  const result = await executeChildRun(deps, lease);
  if (result.outcome !== 'succeeded') return;
  await deps.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $1, conversation_id, 'assistant', $2, id FROM runs WHERE id = $3`,
    [newId(), result.text, lease.runId],
  );
}

interface RunProgress {
  status: string;
  reply: string | null;
}

async function progress(db: Queryable, runId: string): Promise<RunProgress | null> {
  const { rows } = await db.query<{ status: string; reply: string | null }>(
    `SELECT r.status,
            (SELECT m.content FROM messages m
              WHERE m.conversation_id = r.conversation_id AND m.role = 'assistant'
              ORDER BY m.created_at DESC LIMIT 1) AS reply
       FROM runs r WHERE r.id = $1`,
    [runId],
  );
  return rows[0] ?? null;
}

const ENDED_WITHOUT_REPLY = new Set(['failed', 'cancelled', 'outcome_unknown']);

async function waitForReply(db: Queryable, runId: string, pollMs: number): Promise<string> {
  let succeededAt: number | null = null;
  for (;;) {
    const current = await progress(db, runId);
    if (!current) throw new NotesModelError(FAILED);
    if (current.reply !== null) return current.reply;
    if (ENDED_WITHOUT_REPLY.has(current.status)) throw new NotesModelError(FAILED);
    if (current.status === 'succeeded') {
      succeededAt ??= Date.now();
      if (Date.now() - succeededAt > REPLY_GRACE_MS) throw new NotesModelError(FAILED);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function childRunNotesModel(db: Db, workspaceId: string, pollMs = POLL_MS): NotesModel {
  const defaultProvider = async () =>
    (await getSetupState(db, workspaceId)).profile.defaultProvider;
  return {
    async available() {
      return (await defaultProvider()) !== null;
    },
    async complete(prompt) {
      const provider = await defaultProvider();
      if (!provider) throw new NotesModelError('Connect a provider to write notes.');
      const model = await digestModelFor(db, workspaceId, provider);
      const runId = await withTransaction(db, async (client) => {
        const run = await insertHiddenRun(client, workspaceId, {
          title: MEETING_NOTES_TITLE,
          archived: true,
          prompt,
          provider,
          model: model.model,
          effort: model.effort,
        });
        await client.query(`SELECT pg_notify('jobs', $1)`, [run.runId]);
        return run.runId;
      });
      return { text: await waitForReply(db, runId, pollMs), runId };
    },
  };
}
