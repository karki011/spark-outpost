import { RENAMED_TITLE_MAX_LENGTH, clipAtWord } from '@spark-outpost/contracts';
import { resolveRunTarget } from '../api/run-target.ts';
import { insertCompaction } from '../persistence/compactions.ts';
import { sendUserMessage } from '../persistence/conversations.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import type { ContextReading } from '../persistence/provider-sessions.ts';
import type { RunInput } from '../workflow/run-input.ts';

export interface FreshChat {
  id: string;
  title: string;
}

export function continuedTitle(title: string): string {
  return clipAtWord(`${title} (continued)`, RENAMED_TITLE_MAX_LENGTH);
}

export async function startFreshChat(
  db: Db,
  input: Pick<RunInput, 'identity' | 'workspaceId' | 'userRequest'>,
  summary: string,
  reading: ContextReading | null,
): Promise<FreshChat> {
  const id = newId();
  const from = input.identity.threadId;
  const { title, compactionId } = await withTransaction(db, async (client) => {
    const { rows } = await client.query<{ title: string }>(
      'SELECT title FROM conversations WHERE id = $1 AND workspace_id = $2',
      [from, input.workspaceId],
    );
    const named = continuedTitle(rows[0]?.title ?? '');
    await client.query(
      `INSERT INTO conversations (id, workspace_id, title, title_source, provider, overrides,
         model_routing)
       SELECT $1, workspace_id, $3, 'user', provider, overrides, model_routing
       FROM conversations WHERE id = $2`,
      [id, from, named],
    );
    await client.query(
      `INSERT INTO conversation_projects (conversation_id, project_id, position)
       SELECT $1, project_id, position FROM conversation_projects WHERE conversation_id = $2`,
      [id, from],
    );
    const inserted = await insertCompaction(client, {
      conversationId: id,
      runId: null,
      sessionRowId: null,
      agentKey: null,
      method: 'spark',
      tokensBefore: reading?.used ?? null,
      tokensAfter: null,
      contextSize: reading?.size ?? null,
      summary,
      lastMessageId: null,
      fromConversationId: from,
      fromRunId: input.identity.runId,
    });
    return { title: named, compactionId: inserted };
  });
  const target = await resolveRunTarget({ db, workspaceId: input.workspaceId }, id);
  const sent = await sendUserMessage(db, id, { id: newId(), content: input.userRequest }, target);
  await db.query('UPDATE compactions SET run_id = $2 WHERE id = $1', [compactionId, sent.run.id]);
  return { id, title };
}
