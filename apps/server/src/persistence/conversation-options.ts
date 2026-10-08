import type { CreateConversationRequest } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { setConversationProjects } from './conversation-projects.ts';
import { NativeTerminalConflictError } from './native-terminal-turns.ts';

export async function applyConversationOptions(
  db: Queryable,
  workspaceId: string,
  id: string,
  options: Omit<CreateConversationRequest, 'id'>,
): Promise<boolean> {
  const { rows } = await db.query<{
    session_type: string;
    terminal_provider: string | null;
    started: boolean;
    title: string;
  }>(
    `SELECT session_type, terminal_provider, title,
      EXISTS (SELECT 1 FROM messages WHERE conversation_id = $1)
        OR EXISTS (SELECT 1 FROM native_terminal_sessions WHERE conversation_id = $1) AS started
      FROM conversations WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [id, workspaceId],
  );
  const current = rows[0];
  if (!current) return false;
  const sessionType = options.sessionType ?? current.session_type;
  const provider =
    sessionType === 'terminal'
      ? (options.terminalProvider ?? current.terminal_provider ?? 'claude')
      : null;
  if (current.started) {
    if (sessionType !== current.session_type || provider !== current.terminal_provider) {
      throw new NativeTerminalConflictError(
        'Start a new session to change between Chat and Terminal or choose another terminal agent.',
      );
    }
    if (options.projectIds) {
      const projects = await db.query<{ project_id: string }>(
        'SELECT project_id FROM conversation_projects WHERE conversation_id = $1 ORDER BY position, created_at',
        [id],
      );
      if (
        JSON.stringify(projects.rows.map((row) => row.project_id)) !==
        JSON.stringify([...new Set(options.projectIds)])
      ) {
        throw new NativeTerminalConflictError(
          'Change linked projects from this session’s Work panel.',
        );
      }
    }
    return true;
  }
  await db.query(
    'UPDATE conversations SET session_type = $2, terminal_provider = $3 WHERE id = $1',
    [id, sessionType, provider],
  );
  if (options.projectIds)
    await setConversationProjects(db, workspaceId, id, [...new Set(options.projectIds)]);
  if (options.title)
    await db.query('UPDATE conversations SET title = $2 WHERE id = $1', [id, options.title]);
  return true;
}
