import {
  MAP_NEIGHBORS_MAX,
  type MapFileKind,
  type MapNeighbor,
  type MapNeighbors,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { areasById } from './read-store.ts';

type Direction = 'out' | 'in';

const COLUMNS: Record<Direction, { near: string; far: string }> = {
  out: { near: 'from_path', far: 'to_path' },
  in: { near: 'to_path', far: 'from_path' },
};

async function step(
  db: Queryable,
  repoId: string,
  paths: readonly string[],
  direction: Direction,
): Promise<string[]> {
  if (paths.length === 0) return [];
  const { near, far } = COLUMNS[direction];
  const { rows } = await db.query<{ path: string }>(
    `SELECT DISTINCT ${far} AS path FROM map_edges
     WHERE repo_id = $1 AND ${near} = ANY($2::text[])`,
    [repoId, paths],
  );
  return rows.map((row) => row.path);
}

async function reach(
  db: Queryable,
  repoId: string,
  path: string,
  direction: Direction,
  hops: number,
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  let frontier = [path];
  for (let hop = 1; hop <= hops; hop += 1) {
    const next = (await step(db, repoId, frontier, direction)).filter(
      (other) => other !== path && !found.has(other),
    );
    for (const other of next) found.set(other, hop);
    frontier = next;
  }
  return found;
}

interface FileRow {
  path: string;
  area_id: string;
  kind: MapFileKind;
  importance: number;
  fan_in: number;
}

function ranked(found: Map<string, number>, facts: Map<string, FileRow>): MapNeighbor[] {
  return [...found]
    .flatMap(([path, hop]) => {
      const row = facts.get(path);
      return row
        ? [
            {
              path,
              areaId: row.area_id,
              kind: row.kind,
              importance: row.importance,
              fanIn: row.fan_in,
              hop,
            },
          ]
        : [];
    })
    .sort((a, b) => a.hop - b.hop || b.importance - a.importance || a.path.localeCompare(b.path))
    .slice(0, MAP_NEIGHBORS_MAX);
}

async function dependentAreas(
  db: Queryable,
  repoId: string,
  path: string,
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ area_id: string; files: number }>(
    `WITH RECURSIVE dependents(path) AS (
       SELECT from_path FROM map_edges WHERE repo_id = $1 AND to_path = $2
       UNION
       SELECT e.from_path FROM map_edges e JOIN dependents d ON e.to_path = d.path
       WHERE e.repo_id = $1
     )
     SELECT f.area_id, count(*)::int AS files
     FROM dependents d JOIN map_files f ON f.repo_id = $1 AND f.path = d.path
     WHERE d.path <> $2
     GROUP BY f.area_id`,
    [repoId, path],
  );
  return new Map(rows.map((row) => [row.area_id, row.files]));
}

export async function fileNeighbors(
  db: Queryable,
  root: string,
  path: string,
  hops: number,
): Promise<MapNeighbors | null> {
  const { rows } = await db.query<{ repo_id: string; area_id: string }>(
    `SELECT f.repo_id, f.area_id FROM map_files f JOIN map_repos r ON r.id = f.repo_id
     WHERE r.root_path = $1 AND f.path = $2`,
    [root, path],
  );
  const file = rows[0];
  if (!file) return null;
  const [imports, importedBy, areas] = await Promise.all([
    reach(db, file.repo_id, path, 'out', hops),
    reach(db, file.repo_id, path, 'in', hops),
    dependentAreas(db, file.repo_id, path),
  ]);
  const { rows: factRows } = await db.query<FileRow>(
    `SELECT path, area_id, kind, importance, fan_in FROM map_files
     WHERE repo_id = $1 AND path = ANY($2::text[])`,
    [file.repo_id, [...imports.keys(), ...importedBy.keys()]],
  );
  const facts = new Map(factRows.map((row) => [row.path, row]));
  const core = (await areasById(db, root, [...areas.keys()])).filter(
    (area) => area.category === 'core',
  );
  return {
    path,
    areaId: file.area_id,
    hops,
    imports: ranked(imports, facts),
    importedBy: ranked(importedBy, facts),
    importsTotal: imports.size,
    importedByTotal: importedBy.size,
    impact: {
      direct: [...importedBy.values()].filter((hop) => hop === 1).length,
      total: [...areas.values()].reduce((sum, files) => sum + files, 0),
      areas: areas.size,
      coreAreas: core
        .map((area) => ({ id: area.id, name: area.name, files: areas.get(area.id) ?? 0 }))
        .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name)),
    },
  };
}
