import type { Queryable } from '../persistence/db.ts';
import type { Commit } from '../codescan/git.ts';
import type { ProjectLayout } from '../codescan/layout.ts';
import type { SourceFile } from './graph.ts';
import type { PreviousLayout } from './model.ts';

export type MapPhase = 'index' | 'graph' | 'labels' | 'links' | 'done';
export type MapBuildStatus = 'queued' | 'building' | 'paused' | 'ready' | 'failed';

export interface RepoRow {
  id: string;
  rootPath: string;
  rulesVersion: string;
  status: MapBuildStatus;
  phase: MapPhase;
  sourceSignature: string | null;
  builtSignature: string | null;
  checkedAt: Date | null;
  updatedAt: Date;
}

interface RawRepo {
  id: string;
  root_path: string;
  rules_version: string;
  status: MapBuildStatus;
  phase: MapPhase;
  source_signature: string | null;
  built_signature: string | null;
  checked_at: Date | null;
  updated_at: Date;
}

const REPO_COLUMNS =
  'id, root_path, rules_version, status, phase, source_signature, built_signature, checked_at, updated_at';

function toRepo(row: RawRepo): RepoRow {
  return {
    id: row.id,
    rootPath: row.root_path,
    rulesVersion: row.rules_version,
    status: row.status,
    phase: row.phase,
    sourceSignature: row.source_signature,
    builtSignature: row.built_signature,
    checkedAt: row.checked_at,
    updatedAt: row.updated_at,
  };
}

export async function syncRepos(
  db: Queryable,
  rulesVersion: string,
  rootPrefix: string | null = null,
): Promise<void> {
  await db.query(
    `INSERT INTO map_repos (root_path, rules_version)
     SELECT DISTINCT p.root_path, $1 FROM projects p
     WHERE $2::text IS NULL OR starts_with(p.root_path, $2)
     ON CONFLICT (root_path) DO NOTHING`,
    [rulesVersion, rootPrefix],
  );
  await db.query(
    `DELETE FROM map_repos r
     WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.root_path = r.root_path)
        OR ($1::text IS NOT NULL AND NOT starts_with(r.root_path, $1))`,
    [rootPrefix],
  );
}

export async function pendingRepo(db: Queryable): Promise<RepoRow | null> {
  const { rows } = await db.query<RawRepo>(
    `SELECT ${REPO_COLUMNS} FROM map_repos
     WHERE status IN ('queued', 'building', 'paused')
     ORDER BY (status = 'queued'), created_at LIMIT 1`,
  );
  return rows[0] ? toRepo(rows[0]) : null;
}

export async function reposToCheck(db: Queryable, olderThanMs: number): Promise<RepoRow[]> {
  const { rows } = await db.query<RawRepo>(
    `SELECT ${REPO_COLUMNS} FROM map_repos
     WHERE status IN ('ready', 'failed')
       AND (checked_at IS NULL OR checked_at < now() - make_interval(secs => $1))
     ORDER BY checked_at NULLS FIRST, created_at LIMIT 5`,
    [olderThanMs / 1000],
  );
  return rows.map(toRepo);
}

export async function markChecked(db: Queryable, repoId: string): Promise<void> {
  await db.query('UPDATE map_repos SET checked_at = now() WHERE id = $1', [repoId]);
}

export async function queueRepo(db: Queryable, repoId: string, signature: string): Promise<void> {
  await db.query(
    `UPDATE map_repos SET status = 'queued', phase = 'index', source_signature = $2,
       progress_done = 0, progress_total = 0, jev_areas = NULL, error = NULL, checked_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [repoId, signature],
  );
}

export interface Progress {
  status?: MapBuildStatus;
  phase?: MapPhase;
  done?: number;
  total?: number;
  jevAreas?: number;
}

export async function setProgress(
  db: Queryable,
  repoId: string,
  progress: Progress,
): Promise<void> {
  await db.query(
    `UPDATE map_repos SET status = COALESCE($2, status), phase = COALESCE($3, phase),
       progress_done = COALESCE($4, progress_done), progress_total = COALESCE($5, progress_total),
       jev_areas = COALESCE($6, jev_areas),
       started_at = CASE WHEN $2 = 'building' AND status = 'queued' THEN now() ELSE started_at END,
       updated_at = now()
     WHERE id = $1`,
    [
      repoId,
      progress.status ?? null,
      progress.phase ?? null,
      progress.done ?? null,
      progress.total ?? null,
      progress.jevAreas ?? null,
    ],
  );
}

export async function finishRepo(
  db: Queryable,
  repoId: string,
  done: { commit: string | null; timings: Record<string, number> },
): Promise<void> {
  await db.query(
    `UPDATE map_repos SET status = 'ready', phase = 'done', built_signature = source_signature,
       built_commit = $2, built_at = now(), timings = $3, error = NULL, checked_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [repoId, done.commit, JSON.stringify(done.timings)],
  );
}

export async function failRepo(db: Queryable, repoId: string, error: string): Promise<void> {
  await db.query(
    `UPDATE map_repos SET status = 'failed', error = $2, checked_at = now(), updated_at = now()
     WHERE id = $1`,
    [repoId, error.slice(0, 2000)],
  );
}

export async function notifyMap(db: Queryable, repoId: string): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'map', conversationId: null, runId: null, mapId: repoId }),
  ]);
}

export async function agentsBusy(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ busy: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM runs WHERE status IN ('queued', 'running')) AS busy`,
  );
  return rows[0]?.busy ?? false;
}

export interface IndexedSources {
  files: SourceFile[];
  packages: ProjectLayout['packages'];
  owners: ProjectLayout['owners'];
  history: Commit[];
}

export async function loadSources(db: Queryable, root: string): Promise<IndexedSources | null> {
  const project = await db.query<{ id: string; layout: Partial<ProjectLayout>; history: Commit[] }>(
    `SELECT id, layout, history FROM code_index_projects
     WHERE root_path = $1 AND status = 'ready'`,
    [root],
  );
  const row = project.rows[0];
  if (!row) return null;
  const { rows } = await db.query<{
    path: string;
    language: string;
    package: string;
    lines: number;
    has_test: boolean;
    imports: string[];
    endpoints: SourceFile['endpoints'];
  }>(
    `SELECT path, language, package, lines, has_test, imports, endpoints
     FROM code_index_files WHERE project_id = $1 ORDER BY path`,
    [row.id],
  );
  return {
    files: rows.map((file) => ({
      path: file.path,
      language: file.language,
      package: file.package,
      lines: file.lines,
      hasTest: file.has_test,
      imports: file.imports,
      endpoints: file.endpoints,
    })),
    packages: row.layout.packages ?? [],
    owners: row.layout.owners ?? [],
    history: row.history,
  };
}

export async function indexedCommit(db: Queryable, root: string): Promise<string | null> {
  const { rows } = await db.query<{ indexed_commit: string | null }>(
    'SELECT indexed_commit FROM code_index_projects WHERE root_path = $1',
    [root],
  );
  return rows[0]?.indexed_commit ?? null;
}

export async function loadPrevious(db: Queryable, repoId: string): Promise<PreviousLayout> {
  const [files, areas] = await Promise.all([
    db.query<{ path: string; area_id: string; x: number; y: number }>(
      'SELECT path, area_id, x, y FROM map_files WHERE repo_id = $1',
      [repoId],
    ),
    db.query<{ id: string; x: number; y: number; radius: number }>(
      'SELECT id, x, y, radius FROM map_areas WHERE repo_id = $1',
      [repoId],
    ),
  ]);
  return {
    files: new Map(
      files.rows.map((row) => [row.path, { x: row.x, y: row.y, areaId: row.area_id }]),
    ),
    areas: new Map(areas.rows.map((row) => [row.id, { x: row.x, y: row.y, radius: row.radius }])),
  };
}
