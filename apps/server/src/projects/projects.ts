import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Project } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { FolderError, realDirectory } from './folders.ts';

export interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  created_at: Date;
  command_allowlist: string[];
}

export const PROJECT_COLUMNS = 'id, name, root_path, created_at, command_allowlist';

export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project not found.');
  }
}

export function displayPath(root: string, home: string): string {
  if (root === home) return '~';
  if (root.startsWith(`${home}${path.sep}`)) return `~${root.slice(home.length)}`;
  return root;
}

export function toProject(row: ProjectRow, home: string): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    displayPath: displayPath(row.root_path, home),
    createdAt: row.created_at.toISOString(),
    commandAllowlist: row.command_allowlist,
  };
}

export async function realHome(): Promise<string> {
  try {
    return await realpath(homedir());
  } catch {
    return homedir();
  }
}

export async function listProjects(db: Queryable, workspaceId: string): Promise<Project[]> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE workspace_id = $1 ORDER BY lower(name), created_at`,
    [workspaceId],
  );
  const home = await realHome();
  return rows.map((row) => toProject(row, home));
}

export async function getProject(db: Queryable, workspaceId: string, id: string): Promise<Project> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  if (!rows[0]) throw new ProjectNotFoundError();
  return toProject(rows[0], await realHome());
}

export async function projectRoot(rootPath: string): Promise<string> {
  const root = await realDirectory(rootPath);
  if (root === path.parse(root).root || root === (await realHome())) {
    throw new FolderError('Choose a project folder, not your whole disk or home folder.');
  }
  return root;
}

export async function createProject(
  db: Queryable,
  workspaceId: string,
  rootPath: string,
): Promise<{ project: Project; created: boolean }> {
  const root = await projectRoot(rootPath);
  const home = await realHome();
  const inserted = await db.query<ProjectRow>(
    `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, root_path) DO NOTHING RETURNING ${PROJECT_COLUMNS}`,
    [newId(), workspaceId, path.basename(root), root],
  );
  if (inserted.rows[0]) return { project: toProject(inserted.rows[0], home), created: true };
  const { rows } = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE workspace_id = $1 AND root_path = $2`,
    [workspaceId, root],
  );
  return { project: toProject(rows[0]!, home), created: false };
}

export interface ProjectChange {
  name?: string | undefined;
  commandAllowlist?: readonly string[] | undefined;
}

export async function updateProject(
  db: Queryable,
  workspaceId: string,
  id: string,
  change: ProjectChange,
): Promise<Project> {
  const { rows } = await db.query<ProjectRow>(
    `UPDATE projects
     SET name = COALESCE($3, name), command_allowlist = COALESCE($4, command_allowlist)
     WHERE id = $1 AND workspace_id = $2
     RETURNING ${PROJECT_COLUMNS}`,
    [id, workspaceId, change.name ?? null, change.commandAllowlist ?? null],
  );
  if (!rows[0]) throw new ProjectNotFoundError();
  return toProject(rows[0], await realHome());
}
