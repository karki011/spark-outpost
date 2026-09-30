import type { CoreImpact, TaskChanges } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { taskRoots } from '../ship/task-facts.ts';
import { areasById } from './read-store.ts';

const KEY_FILE_SHARE = 0.02;
const KEY_FILES_SHOWN = 5;

const NO_IMPACT: CoreImpact = { areas: [], keyFiles: [] };

async function mapRootFor(db: Queryable, root: string): Promise<string> {
  const { rows } = await db.query<{ root_path: string }>(
    `SELECT p.root_path FROM chat_worktrees cw JOIN projects p ON p.id = cw.project_id
     WHERE cw.path = $1 LIMIT 1`,
    [root],
  );
  return rows[0]?.root_path ?? root;
}

export function hasCoreImpact(impact: CoreImpact | null): impact is CoreImpact {
  return impact !== null && (impact.areas.length > 0 || impact.keyFiles.length > 0);
}

export async function coreImpact(
  db: Queryable,
  root: string,
  paths: readonly string[],
): Promise<CoreImpact> {
  if (paths.length === 0) return NO_IMPACT;
  const mapRoot = await mapRootFor(db, root);
  const { rows } = await db.query<{ path: string; area_id: string; key_file: boolean }>(
    `WITH repo AS (SELECT id FROM map_repos WHERE root_path = $1),
       cut AS (
         SELECT percentile_disc($3::float8) WITHIN GROUP (ORDER BY importance DESC) AS importance
         FROM map_files WHERE repo_id = (SELECT id FROM repo)
       )
     SELECT f.path, f.area_id, f.importance > 0 AND f.importance >= cut.importance AS key_file
     FROM map_files f, cut
     WHERE f.repo_id = (SELECT id FROM repo) AND f.path = ANY($2::text[])
     ORDER BY f.importance DESC, f.path`,
    [mapRoot, paths, KEY_FILE_SHARE],
  );
  if (rows.length === 0) return NO_IMPACT;
  const touched = new Map<string, number>();
  for (const row of rows) touched.set(row.area_id, (touched.get(row.area_id) ?? 0) + 1);
  const core = (await areasById(db, mapRoot, [...touched.keys()])).filter(
    (area) => area.category === 'core',
  );
  return {
    areas: core
      .map((area) => ({ id: area.id, name: area.name, files: touched.get(area.id) ?? 0 }))
      .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name)),
    keyFiles: rows
      .filter((row) => row.key_file)
      .slice(0, KEY_FILES_SHOWN)
      .map((row) => row.path),
  };
}

export async function taskCoreImpact(
  db: Queryable,
  taskId: string,
  changes: TaskChanges,
): Promise<CoreImpact | null> {
  const paths = changes.runs
    .filter((run) => !run.revertedAt)
    .flatMap((run) => run.files.map((file) => file.path));
  if (paths.length === 0) return null;
  const { roots } = await taskRoots(db, taskId);
  if (roots.length !== 1) return null;
  const impact = await coreImpact(db, roots[0]!, [...new Set(paths)]);
  return hasCoreImpact(impact) ? impact : null;
}
