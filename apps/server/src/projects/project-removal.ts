import {
  CONVERSATION_PROJECTS_MAX,
  DEFAULT_WORK_PLACE,
  PIECE_SLOTS_MAX,
  type Project,
  type RemovedProject,
} from '@spark-outpost/contracts';
import { withTransaction, type Db, type DbClient } from '../persistence/db.ts';
import {
  PROJECT_COLUMNS,
  ProjectNotFoundError,
  projectRoot,
  projectRowAt,
  realHome,
  toProject,
  type ProjectRow,
} from './projects.ts';

interface LinkRow {
  conversation_id: string;
  position: number;
}

const RESTORE_LINKS = `INSERT INTO conversation_projects (conversation_id, project_id, position)
  SELECT linked.id, $1,
    CASE WHEN EXISTS (
      SELECT 1 FROM conversation_projects taken
      WHERE taken.conversation_id = linked.id AND taken.position = linked.position
    ) THEN (
      SELECT max(other.position) + 1 FROM conversation_projects other
      WHERE other.conversation_id = linked.id
    ) ELSE linked.position END
  FROM unnest($2::uuid[], $3::int[]) AS linked (id, position)
  JOIN conversations c ON c.id = linked.id AND c.workspace_id = $4
  WHERE (
    SELECT count(*) FROM conversation_projects existing
    WHERE existing.conversation_id = linked.id
  ) < $5
  ON CONFLICT (conversation_id, project_id) DO NOTHING`;

export async function removeProject(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<RemovedProject> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [id, workspaceId],
    );
    if (!rows[0]) throw new ProjectNotFoundError();
    const links = await client.query<LinkRow>(
      `SELECT conversation_id, position FROM conversation_projects
       WHERE project_id = $1 ORDER BY conversation_id`,
      [id],
    );
    await client.query('DELETE FROM projects WHERE id = $1', [id]);
    await client.query(
      `DELETE FROM code_index_projects WHERE root_path = $1
       AND NOT EXISTS (SELECT 1 FROM projects WHERE root_path = $1)`,
      [rows[0].root_path],
    );
    return {
      project: toProject(rows[0], await realHome()),
      links: links.rows.map((row) => ({
        conversationId: row.conversation_id,
        position: row.position,
      })),
    };
  });
}

async function insertProject(
  client: DbClient,
  workspaceId: string,
  project: Project,
  root: string,
): Promise<ProjectRow> {
  const inserted = await client.query<ProjectRow>(
    `INSERT INTO projects
       (id, workspace_id, name, root_path, created_at, command_allowlist, check_commands,
        parallel_pieces, piece_slots, work_place)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING RETURNING ${PROJECT_COLUMNS}`,
    [
      project.id,
      workspaceId,
      project.name,
      root,
      project.createdAt,
      project.commandAllowlist,
      project.checkCommands ?? null,
      project.parallelPieces ?? true,
      project.pieceSlots ?? PIECE_SLOTS_MAX,
      project.workPlace ?? DEFAULT_WORK_PLACE,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const existing = await projectRowAt(client, workspaceId, root);
  if (!existing) throw new ProjectNotFoundError();
  return existing;
}

export async function restoreProject(
  db: Db,
  workspaceId: string,
  removed: RemovedProject,
): Promise<Project> {
  const root = await projectRoot(removed.project.rootPath);
  const { links } = removed;
  return withTransaction(db, async (client) => {
    const row = await insertProject(client, workspaceId, removed.project, root);
    await client.query(RESTORE_LINKS, [
      row.id,
      links.map((link) => link.conversationId),
      links.map((link) => link.position),
      workspaceId,
      CONVERSATION_PROJECTS_MAX,
    ]);
    return toProject(row, await realHome());
  });
}
