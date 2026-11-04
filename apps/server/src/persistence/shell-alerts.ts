import type { Queryable } from './db.ts';

export interface ShellAlert {
  conversationId: string;
  shellId: string;
  label: string;
  message: string;
}

const KEEP_DAYS = 30;

export async function recordShellAlert(
  db: Queryable,
  workspaceId: string,
  alert: ShellAlert,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO shell_alerts (workspace_id, conversation_id, shell_id, label, message)
     SELECT $1, c.id, $3, $4, $5 FROM conversations c
     WHERE c.id = $2 AND c.workspace_id = $1 AND c.archived_at IS NULL
     ON CONFLICT (shell_id) DO UPDATE SET id = gen_random_uuid(),
       conversation_id = EXCLUDED.conversation_id, label = EXCLUDED.label,
       message = EXCLUDED.message, created_at = now()`,
    [workspaceId, alert.conversationId, alert.shellId, alert.label.slice(0, 200), alert.message],
  );
  await db.query(
    `DELETE FROM shell_alerts WHERE workspace_id = $1 AND created_at < now() - $2::interval`,
    [workspaceId, `${KEEP_DAYS} days`],
  );
  return (rowCount ?? 0) > 0;
}
