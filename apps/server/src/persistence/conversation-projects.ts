import type { Queryable } from './db.ts';
import { ProjectNotFoundError } from '../projects/projects.ts';

const INSERT_LINKS = `INSERT INTO conversation_projects (conversation_id, project_id, position)
  SELECT $1, linked.id, linked.position - 1
  FROM unnest($2::uuid[]) WITH ORDINALITY AS linked (id, position)
  ON CONFLICT (conversation_id, project_id)`;

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
  await db.query(`${INSERT_LINKS} DO UPDATE SET position = EXCLUDED.position`, [
    conversationId,
    projectIds,
  ]);
}
