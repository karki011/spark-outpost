import type { Queryable } from '../persistence/db.ts';
import type { Commit } from './git.ts';
import type { ProjectLayout } from './layout.ts';
import type { NameStats, NodeFacts } from './rank.ts';

export const NEIGHBOUR_LIMIT = 600;
export const PATH_MATCH_LIMIT = 40;
export const DEFINER_LIMIT = 200;

export interface ScanProject {
  id: string;
  status: 'building' | 'ready';
  fileCount: number;
  layout: ProjectLayout;
  history: Commit[];
}

export async function loadScanProject(db: Queryable, root: string): Promise<ScanProject | null> {
  const { rows } = await db.query<{
    id: string;
    status: 'building' | 'ready';
    file_count: number;
    layout: Partial<ProjectLayout>;
    history: Commit[];
  }>(
    'SELECT id, status, file_count, layout, history FROM code_index_projects WHERE root_path = $1',
    [root],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    fileCount: row.file_count,
    layout: {
      tools: row.layout.tools ?? [],
      packages: row.layout.packages ?? [],
      instructions: row.layout.instructions ?? [],
      owners: row.layout.owners ?? [],
    },
    history: row.history,
  };
}

export async function nameIds(
  db: Queryable,
  projectId: string,
  names: readonly string[],
): Promise<Map<string, number>> {
  if (names.length === 0) return new Map();
  const { rows } = await db.query<{ id: number; name: string }>(
    'SELECT id, name FROM code_index_names WHERE project_id = $1 AND name = ANY($2::text[])',
    [projectId, names],
  );
  return new Map(rows.map((row) => [row.name, row.id]));
}

export async function definersOf(
  db: Queryable,
  projectId: string,
  ids: readonly number[],
): Promise<Map<string, number[]>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ path: string; ids: number[] }>(
    `SELECT path, ARRAY(SELECT unnest(def_ids) INTERSECT SELECT unnest($2::int[])) AS ids
     FROM code_index_files WHERE project_id = $1 AND def_ids && $2::int[] LIMIT $3`,
    [projectId, ids, DEFINER_LIMIT],
  );
  return new Map(rows.map((row) => [row.path, row.ids]));
}

export async function nameStats(
  db: Queryable,
  projectId: string,
  ids: readonly number[],
): Promise<Map<number, NameStats>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: number; def_files: number; ref_files: number }>(
    `SELECT id, def_files, ref_files FROM code_index_names
     WHERE project_id = $1 AND id = ANY($2::int[])`,
    [projectId, ids],
  );
  return new Map(rows.map((row) => [row.id, { defFiles: row.def_files, refFiles: row.ref_files }]));
}

export async function pathsLike(
  db: Queryable,
  projectId: string,
  fragments: readonly string[],
): Promise<string[]> {
  if (fragments.length === 0) return [];
  const { rows } = await db.query<{ path: string }>(
    `SELECT DISTINCT f.path FROM unnest($2::text[]) AS q (fragment)
     CROSS JOIN LATERAL (
       SELECT path FROM code_index_files
       WHERE project_id = $1 AND (path = q.fragment OR path LIKE '%/' || q.fragment)
       LIMIT $3
     ) f`,
    [projectId, fragments, PATH_MATCH_LIMIT],
  );
  return rows.map((row) => row.path);
}

export async function pathsWithWords(
  db: Queryable,
  projectId: string,
  words: readonly string[],
): Promise<Map<string, number>> {
  if (words.length === 0) return new Map();
  const { rows } = await db.query<{ path: string; words: number }>(
    `SELECT f.path, count(*)::int AS words FROM unnest($2::text[]) AS q (word)
     CROSS JOIN LATERAL (
       SELECT path FROM code_index_files
       WHERE project_id = $1 AND lower(path) LIKE '%' || q.word || '%'
       ORDER BY position(q.word IN lower(substring(path FROM '[^/]*$'))) > 0 DESC, length(path)
       LIMIT $3
     ) f GROUP BY f.path`,
    [projectId, words, PATH_MATCH_LIMIT],
  );
  return new Map(rows.map((row) => [row.path, row.words]));
}

interface FactRow {
  path: string;
  def_ids: number[];
  ref_ids: number[];
  lines: number;
  package: string;
  has_test: boolean;
}

function toFacts(rows: readonly FactRow[]): Map<string, NodeFacts> {
  return new Map(
    rows.map((row) => [
      row.path,
      {
        defIds: row.def_ids,
        refIds: row.ref_ids,
        lines: row.lines,
        package: row.package,
        hasTest: row.has_test,
      },
    ]),
  );
}

const FACT_COLUMNS = 'path, def_ids, ref_ids, lines, package, has_test';

export async function factsFor(
  db: Queryable,
  projectId: string,
  paths: readonly string[],
): Promise<Map<string, NodeFacts>> {
  if (paths.length === 0) return new Map();
  const { rows } = await db.query<FactRow>(
    `SELECT ${FACT_COLUMNS} FROM code_index_files WHERE project_id = $1 AND path = ANY($2::text[])`,
    [projectId, paths],
  );
  return toFacts(rows);
}

export async function neighbours(
  db: Queryable,
  projectId: string,
  referenced: readonly number[],
  defined: readonly number[],
  exclude: readonly string[],
): Promise<Map<string, NodeFacts>> {
  if (referenced.length === 0 && defined.length === 0) return new Map();
  const { rows } = await db.query<FactRow>(
    `WITH defining AS MATERIALIZED (
       SELECT path FROM code_index_files WHERE project_id = $1 AND def_ids && $2::int[]
     ), referencing AS MATERIALIZED (
       SELECT path FROM code_index_files WHERE project_id = $1 AND ref_ids && $3::int[]
     ), picked AS (
       (SELECT path FROM defining WHERE NOT path = ANY($4::text[]) LIMIT $5)
       UNION
       (SELECT path FROM referencing WHERE NOT path = ANY($4::text[]) LIMIT $5)
     )
     SELECT ${FACT_COLUMNS} FROM code_index_files
     WHERE project_id = $1 AND path IN (SELECT path FROM picked)`,
    [projectId, referenced, defined, exclude, NEIGHBOUR_LIMIT / 2],
  );
  return toFacts(rows);
}
