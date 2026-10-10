import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_WORK_PLACE,
  previewConfigSchema,
  workPlaceSchema,
  type PreviewConfig,
  type Project,
  type WorkPlace,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { FolderError, realDirectory } from './folders.ts';

export interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  created_at: Date;
  command_allowlist: string[];
  check_commands: string[] | null;
  parallel_pieces: boolean;
  piece_slots: number;
  work_place: string;
  browser_keep_sign_ins: boolean;
  preview: unknown;
  last_used_at?: Date;
}

export const PROJECT_COLUMNS =
  'id, name, root_path, created_at, command_allowlist, check_commands, parallel_pieces, piece_slots, work_place, browser_keep_sign_ins, preview';

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

export function storedPreview(value: unknown): PreviewConfig | null {
  const parsed = previewConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toProject(row: ProjectRow, home: string): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    displayPath: displayPath(row.root_path, home),
    createdAt: row.created_at.toISOString(),
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at.toISOString() } : {}),
    commandAllowlist: row.command_allowlist,
    checkCommands: row.check_commands,
    parallelPieces: row.parallel_pieces,
    pieceSlots: row.piece_slots,
    workPlace: workPlaceSchema.catch(DEFAULT_WORK_PLACE).parse(row.work_place),
    browserKeepSignIns: row.browser_keep_sign_ins,
    preview: storedPreview(row.preview),
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
    `SELECT ${PROJECT_COLUMNS}, GREATEST(
       created_at,
       (SELECT max(cp.created_at) FROM conversation_projects cp WHERE cp.project_id = projects.id),
       (SELECT max(r.created_at) FROM conversation_projects cp
        JOIN runs r ON r.conversation_id = cp.conversation_id
        WHERE cp.project_id = projects.id)
     ) AS last_used_at
     FROM projects WHERE workspace_id = $1 ORDER BY sort_order NULLS LAST, lower(name), created_at`,
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

export async function projectRowAt(
  db: Queryable,
  workspaceId: string,
  root: string,
): Promise<ProjectRow | undefined> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE workspace_id = $1 AND root_path = $2`,
    [workspaceId, root],
  );
  return rows[0];
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
  const existing = await projectRowAt(db, workspaceId, root);
  return { project: toProject(existing!, home), created: false };
}

export interface ProjectChange {
  name?: string | undefined;
  commandAllowlist?: readonly string[] | undefined;
  workPlace?: WorkPlace | undefined;
  browserKeepSignIns?: boolean | undefined;
}

export async function updateProject(
  db: Queryable,
  workspaceId: string,
  id: string,
  change: ProjectChange,
): Promise<Project> {
  const { rows } = await db.query<ProjectRow>(
    `UPDATE projects
     SET name = COALESCE($3, name), command_allowlist = COALESCE($4, command_allowlist),
         work_place = COALESCE($5, work_place),
         browser_keep_sign_ins = COALESCE($6, browser_keep_sign_ins)
     WHERE id = $1 AND workspace_id = $2
     RETURNING ${PROJECT_COLUMNS}`,
    [
      id,
      workspaceId,
      change.name ?? null,
      change.commandAllowlist ?? null,
      change.workPlace ?? null,
      change.browserKeepSignIns ?? null,
    ],
  );
  if (!rows[0]) throw new ProjectNotFoundError();
  return toProject(rows[0], await realHome());
}

export async function saveProjectPreview(
  db: Queryable,
  workspaceId: string,
  id: string,
  preview: PreviewConfig | null,
): Promise<Project> {
  const { rows } = await db.query<ProjectRow>(
    `UPDATE projects SET preview = $3::jsonb WHERE id = $1 AND workspace_id = $2
     RETURNING ${PROJECT_COLUMNS}`,
    [id, workspaceId, preview === null ? null : JSON.stringify(preview)],
  );
  if (!rows[0]) throw new ProjectNotFoundError();
  return toProject(rows[0], await realHome());
}

export async function orderProjects(
  db: Queryable,
  workspaceId: string,
  projectIds: readonly string[],
): Promise<void> {
  await db.query(
    `UPDATE projects p SET sort_order = ordered.position
     FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered (id, position)
     WHERE p.id = ordered.id AND p.workspace_id = $1`,
    [workspaceId, projectIds],
  );
}

export async function orderProjectChats(
  db: Queryable,
  workspaceId: string,
  projectId: string,
  conversationIds: readonly string[],
): Promise<void> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2',
    [projectId, workspaceId],
  );
  if (!rowCount) throw new ProjectNotFoundError();
  await db.query(
    `UPDATE conversation_projects cp SET sort_order = ordered.position
     FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered (id, position)
     WHERE cp.project_id = $1 AND cp.conversation_id = ordered.id`,
    [projectId, conversationIds],
  );
}
