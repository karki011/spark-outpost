import type { Db } from '../persistence/db.ts';
import { trackChatPull } from '../pr-tracking/track.ts';

interface Opener {
  conversation_id: string;
  provider: string;
  role: string | null;
}

export async function adoptAgentPullRequest(
  db: Db,
  runId: string,
  taskId: string | null,
  url: string,
): Promise<void> {
  const { rows } = await db.query<Opener>(
    'SELECT conversation_id, provider, role FROM runs WHERE id = $1',
    [runId],
  );
  const opener = rows[0];
  if (!opener) return;
  await trackChatPull(db, {
    conversationId: opener.conversation_id,
    url,
    via: 'agent',
    by: opener.role ?? opener.provider,
    runId,
    taskId,
  });
}
