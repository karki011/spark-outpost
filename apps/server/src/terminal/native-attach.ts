import type { CreateShellResponse } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { LiveSession, PendingNativeLaunch } from './native-runtime-types.ts';
import type { TerminalSessions } from './sessions.ts';

export async function attachNativeSession(
  db: Db,
  workspaceId: string,
  terminals: TerminalSessions,
  live: Map<string, LiveSession>,
  launches: Map<string, PendingNativeLaunch>,
  id: string,
): Promise<CreateShellResponse | null> {
  let session = [...live.values()].find((item) => item.row.id === id);
  if (launches.size && (!session || launches.has(session.row.conversation_id))) {
    const { rows } = await db.query<{ conversation_id: string }>(
      `SELECT n.conversation_id FROM native_terminal_sessions n
       JOIN conversations c ON c.id = n.conversation_id WHERE n.id = $1 AND c.workspace_id = $2`,
      [id, workspaceId],
    );
    const pending = rows[0] ? launches.get(rows[0].conversation_id) : undefined;
    if (pending) await pending.work;
    session = [...live.values()].find((item) => item.row.id === id);
  }
  if (!session) return null;
  const connection = terminals.reattach(id);
  return connection ? { ...connection, ...session.folder } : null;
}
