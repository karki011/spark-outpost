import { CONVERSATION_PROJECTS_MAX } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { ProjectNotFoundError } from '../projects/projects.ts';

export async function setConversationProjects(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  projectIds: readonly string[],
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM projects WHERE workspace_id = $1 AND id = ANY($2::uuid[])',
    [workspaceId, projectIds],
  );
  if (rows.length !== projectIds.length) throw new ProjectNotFoundError();
  await db.query(
    `DELETE FROM conversation_projects
     WHERE conversation_id = $1 AND NOT (project_id = ANY($2::uuid[]))`,
    [conversationId, projectIds],
  );
  await db.query(
    `INSERT INTO conversation_projects (conversation_id, project_id, position)
     SELECT $1, linked.id, linked.position - 1
     FROM unnest($2::uuid[]) WITH ORDINALITY AS linked (id, position)
     ON CONFLICT (conversation_id, project_id) DO UPDATE SET position = EXCLUDED.position`,
    [conversationId, projectIds],
  );
}

export async function conversationRoots(db: Queryable, conversationId: string): Promise<string[]> {
  const { rows } = await db.query<{ root_path: string }>(
    `SELECT p.root_path FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
     WHERE cp.conversation_id = $1 ORDER BY cp.position, cp.created_at`,
    [conversationId],
  );
  return rows.map((row) => row.root_path);
}

export type AppendedProject = 'linked' | 'already_linked' | 'full';

export async function appendConversationProject(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  projectId: string,
): Promise<AppendedProject> {
  const { rows } = await db.query<{ project_id: string }>(
    `SELECT project_id FROM conversation_projects
     WHERE conversation_id = $1 ORDER BY position, created_at FOR UPDATE`,
    [conversationId],
  );
  const linked = rows.map((row) => row.project_id);
  if (linked.includes(projectId)) return 'already_linked';
  if (linked.length >= CONVERSATION_PROJECTS_MAX) return 'full';
  await setConversationProjects(db, workspaceId, conversationId, [...linked, projectId]);
  return 'linked';
}
