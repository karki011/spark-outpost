import type { Queryable } from '../persistence/db.ts';
import type { Commit } from './git.ts';
import type { ProjectLayout } from './layout.ts';
import type { CachedFile } from './refresh-plan.ts';

export const WRITE_BATCH = 500;

export interface IndexProject {
  id: string;
  rootPath: string;
  status: 'building' | 'ready';
  parserVersion: string;
  indexedCommit: string | null;
  fileCount: number;
  historyAt: Date | null;
}

export interface CachedRow extends CachedFile {
  package: string;
  hasTest: boolean;
}

export interface FileRow {
  path: string;
  size: number;
  mtime_ms: number;
  content_hash: string;
  parser_version: string;
  language: string;
  package: string;
  lines: number;
  has_test: boolean;
  def_ids: number[];
  def_kinds: number[];
  ref_ids: number[];
}

interface ProjectRow {
  id: string;
  root_path: string;
  status: 'building' | 'ready';
  parser_version: string;
  indexed_commit: string | null;
  file_count: number;
  history_at: Date | null;
}

const PROJECT_COLUMNS =
  'id, root_path, status, parser_version, indexed_commit, file_count, history_at';

function toProject(row: ProjectRow): IndexProject {
  return {
    id: row.id,
    rootPath: row.root_path,
    status: row.status,
    parserVersion: row.parser_version,
    indexedCommit: row.indexed_commit,
    fileCount: row.file_count,
    historyAt: row.history_at,
  };
}

export async function findIndexProject(db: Queryable, root: string): Promise<IndexProject | null> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM code_index_projects WHERE root_path = $1`,
    [root],
  );
  return rows[0] ? toProject(rows[0]) : null;
}

export async function startIndexProject(
  db: Queryable,
  root: string,
  parserVersion: string,
): Promise<IndexProject> {
  await db.query('DELETE FROM code_index_projects WHERE root_path = $1', [root]);
  const { rows } = await db.query<ProjectRow>(
    `INSERT INTO code_index_projects (root_path, status, parser_version)
     VALUES ($1, 'building', $2)
     RETURNING ${PROJECT_COLUMNS}`,
    [root, parserVersion],
  );
  return toProject(rows[0] as ProjectRow);
}

export async function fileParserVersions(db: Queryable, projectId: string): Promise<string[]> {
  const { rows } = await db.query<{ parser_version: string }>(
    'SELECT DISTINCT parser_version FROM code_index_files WHERE project_id = $1',
    [projectId],
  );
  return rows.map((row) => row.parser_version);
}

export async function cachedFiles(
  db: Queryable,
  projectId: string,
): Promise<Map<string, CachedRow>> {
  const { rows } = await db.query<{
    path: string;
    size: number;
    mtime_ms: string;
    content_hash: string;
    package: string;
    has_test: boolean;
  }>(
    `SELECT path, size, mtime_ms, content_hash, package, has_test
     FROM code_index_files WHERE project_id = $1`,
    [projectId],
  );
  return new Map(
    rows.map((row) => [
      row.path,
      {
        path: row.path,
        size: row.size,
        mtimeMs: Number(row.mtime_ms),
        hash: row.content_hash,
        package: row.package,
        hasTest: row.has_test,
      },
    ]),
  );
}

export async function projectNames(db: Queryable, projectId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ id: number; name: string }>(
    'SELECT id, name FROM code_index_names WHERE project_id = $1',
    [projectId],
  );
  return new Map(rows.map((row) => [row.name, row.id]));
}

export async function insertNames(
  db: Queryable,
  projectId: string,
  names: readonly (readonly [number, string])[],
): Promise<void> {
  for (let start = 0; start < names.length; start += WRITE_BATCH * 10) {
    const batch = names.slice(start, start + WRITE_BATCH * 10);
    await db.query(
      `INSERT INTO code_index_names (project_id, id, name)
       SELECT $1, * FROM unnest($2::int[], $3::text[])`,
      [projectId, batch.map(([id]) => id), batch.map(([, name]) => name)],
    );
  }
}

export async function upsertFiles(
  db: Queryable,
  projectId: string,
  rows: readonly FileRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `INSERT INTO code_index_files (project_id, path, size, mtime_ms, content_hash, parser_version,
       language, package, lines, has_test, def_ids, def_kinds, ref_ids)
     SELECT $1, r.path, r.size, r.mtime_ms, r.content_hash, r.parser_version, r.language,
       r.package, r.lines, r.has_test, r.def_ids, r.def_kinds, r.ref_ids
     FROM jsonb_to_recordset($2::jsonb) AS r (path text, size integer, mtime_ms bigint,
       content_hash text, parser_version text, language text, package text, lines integer,
       has_test boolean, def_ids integer[], def_kinds smallint[], ref_ids integer[])
     ON CONFLICT (project_id, path) DO UPDATE SET size = EXCLUDED.size,
       mtime_ms = EXCLUDED.mtime_ms, content_hash = EXCLUDED.content_hash,
       parser_version = EXCLUDED.parser_version, language = EXCLUDED.language,
       package = EXCLUDED.package, lines = EXCLUDED.lines, has_test = EXCLUDED.has_test,
       def_ids = EXCLUDED.def_ids, def_kinds = EXCLUDED.def_kinds, ref_ids = EXCLUDED.ref_ids`,
    [projectId, JSON.stringify(rows)],
  );
}

export async function touchFiles(
  db: Queryable,
  projectId: string,
  rows: readonly { path: string; size: number; mtime_ms: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `UPDATE code_index_files f SET size = r.size, mtime_ms = r.mtime_ms
     FROM jsonb_to_recordset($2::jsonb) AS r (path text, size integer, mtime_ms bigint)
     WHERE f.project_id = $1 AND f.path = r.path`,
    [projectId, JSON.stringify(rows)],
  );
}

export async function relabelFiles(
  db: Queryable,
  projectId: string,
  rows: readonly { path: string; package: string; has_test: boolean }[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `UPDATE code_index_files f SET package = r.package, has_test = r.has_test
     FROM jsonb_to_recordset($2::jsonb) AS r (path text, package text, has_test boolean)
     WHERE f.project_id = $1 AND f.path = r.path`,
    [projectId, JSON.stringify(rows)],
  );
}

export async function deleteFiles(
  db: Queryable,
  projectId: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return;
  await db.query('DELETE FROM code_index_files WHERE project_id = $1 AND path = ANY($2::text[])', [
    projectId,
    paths,
  ]);
}

export async function pruneNames(db: Queryable, projectId: string): Promise<void> {
  await db.query(
    `DELETE FROM code_index_names n WHERE n.project_id = $1 AND NOT EXISTS (
       SELECT 1 FROM (
         SELECT DISTINCT unnest(def_ids || ref_ids) AS id FROM code_index_files
         WHERE project_id = $1
       ) used WHERE used.id = n.id
     )`,
    [projectId],
  );
}

export async function countNameUse(db: Queryable, projectId: string): Promise<void> {
  await db.query(
    `UPDATE code_index_names n SET def_files = c.defs, ref_files = c.refs
     FROM (
       SELECT id, sum(d)::int AS defs, sum(r)::int AS refs FROM (
         SELECT unnest(def_ids) AS id, 1 AS d, 0 AS r FROM code_index_files WHERE project_id = $1
         UNION ALL
         SELECT unnest(ref_ids), 0, 1 FROM code_index_files WHERE project_id = $1
       ) uses GROUP BY id
     ) c
     WHERE n.project_id = $1 AND n.id = c.id
       AND (n.def_files, n.ref_files) IS DISTINCT FROM (c.defs, c.refs)`,
    [projectId],
  );
}

export interface FinishedIndex {
  commit: string | null;
  listedCount: number;
  layout: ProjectLayout;
  history: readonly Commit[] | null;
}

export async function finishIndex(
  db: Queryable,
  projectId: string,
  done: FinishedIndex,
): Promise<void> {
  await db.query(
    `UPDATE code_index_projects p SET status = 'ready', indexed_commit = $2, listed_count = $3,
       layout = $4, history = COALESCE($5::jsonb, p.history),
       history_at = CASE WHEN $5::jsonb IS NULL THEN p.history_at ELSE now() END,
       indexed_at = now(), last_opened_at = now(),
       file_count = (SELECT count(*) FROM code_index_files f WHERE f.project_id = p.id),
       name_count = (SELECT count(*) FROM code_index_names n WHERE n.project_id = p.id),
       row_bytes = COALESCE((SELECT sum(pg_column_size(f.*)) FROM code_index_files f
                 WHERE f.project_id = p.id), 0)
             + COALESCE((SELECT sum(pg_column_size(n.*)) FROM code_index_names n
                 WHERE n.project_id = p.id), 0)
             + pg_column_size(p.*)
     WHERE p.id = $1`,
    [
      projectId,
      done.commit,
      done.listedCount,
      JSON.stringify(done.layout),
      done.history ? JSON.stringify(done.history) : null,
    ],
  );
}
