import type { Queryable } from './db.ts';

export interface OpenShell {
  id: string;
  conversationId: string | null;
  label: string;
  cwd: string;
  pid: number;
}

export interface ShellRow extends OpenShell {
  chatTitle: string | null;
  openedAt: string;
}

export async function recordShell(
  db: Queryable,
  workspaceId: string,
  shell: OpenShell,
): Promise<void> {
  await db.query(
    `INSERT INTO terminal_shells (id, workspace_id, conversation_id, label, cwd, pid)
     SELECT $1, $2, c.id, $4, $5, $6 FROM (SELECT 1) one
     LEFT JOIN conversations c ON c.id = $3 AND c.workspace_id = $2
     ON CONFLICT (id) DO NOTHING`,
    [shell.id, workspaceId, shell.conversationId, shell.label.slice(0, 200), shell.cwd, shell.pid],
  );
}

export async function forgetShell(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM terminal_shells WHERE id = $1', [id]);
}

export async function forgetAllShells(db: Queryable, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM terminal_shells WHERE workspace_id = $1', [workspaceId]);
}

interface Row {
  id: string;
  conversation_id: string | null;
  chat_title: string | null;
  label: string;
  cwd: string;
  pid: number;
  opened_at: Date;
}

export async function listShells(db: Queryable, workspaceId: string): Promise<ShellRow[]> {
  const { rows } = await db.query<Row>(
    `SELECT s.id, s.conversation_id, c.title AS chat_title, s.label, s.cwd, s.pid, s.opened_at
     FROM terminal_shells s LEFT JOIN conversations c ON c.id = s.conversation_id
     WHERE s.workspace_id = $1 ORDER BY s.opened_at`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    chatTitle: row.chat_title,
    label: row.label,
    cwd: row.cwd,
    pid: row.pid,
    openedAt: row.opened_at.toISOString(),
  }));
}
