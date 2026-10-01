import type { RankedFile } from '../codescan/rank.ts';
import { factsFor, loadScanProject } from '../codescan/scan-store.ts';
import { areasById } from '../map/read-store.ts';
import type { Queryable } from '../persistence/db.ts';
import { isSecretPath } from '../projects/path-policy.ts';
import { isGlob } from './owned.ts';

export interface FileFacts {
  lines: number | null;
  symbols: number | null;
  references: number | null;
  churn: number | null;
  package: string | null;
  hasTest: boolean | null;
  area: string | null;
  kind: string | null;
  fanIn: number | null;
  importance: number | null;
}

interface MapFileRow {
  path: string;
  area_id: string;
  kind: string;
  fan_in: number;
  importance: number;
  change_count: number;
}

const EMPTY: FileFacts = {
  lines: null,
  symbols: null,
  references: null,
  churn: null,
  package: null,
  hasTest: null,
  area: null,
  kind: null,
  fanIn: null,
  importance: null,
};

export function factPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].filter((path) => !isGlob(path) && !isSecretPath(path));
}

function fromScan(file: RankedFile): Partial<FileFacts> {
  return {
    lines: file.lines,
    symbols: file.symbols,
    references: file.references,
    churn: file.churn,
    package: file.package,
    hasTest: file.hasTest,
  };
}

async function indexFacts(db: Queryable, root: string, paths: readonly string[]) {
  const project = await loadScanProject(db, root);
  if (!project) return new Map<string, Partial<FileFacts>>();
  const facts = await factsFor(db, project.id, paths);
  return new Map(
    [...facts].map(([path, fact]): [string, Partial<FileFacts>] => [
      path,
      {
        lines: fact.lines,
        symbols: fact.defIds.length,
        package: fact.package,
        hasTest: fact.hasTest,
      },
    ]),
  );
}

async function mapFacts(db: Queryable, root: string, paths: readonly string[]) {
  const { rows } = await db.query<MapFileRow>(
    `SELECT f.path, f.area_id, f.kind, f.fan_in, f.importance, f.change_count
     FROM map_files f JOIN map_repos r ON r.id = f.repo_id
     WHERE r.root_path = $1 AND f.path = ANY($2::text[])`,
    [root, paths],
  );
  const areas = await areasById(db, root, [...new Set(rows.map((row) => row.area_id))]);
  const byId = new Map(areas.map((area) => [area.id, area]));
  return new Map(
    rows.map((row): [string, Partial<FileFacts>] => {
      const area = byId.get(row.area_id);
      return [
        row.path,
        {
          area: area ? `${area.name} (${area.category}, ${area.kind})` : null,
          kind: row.kind,
          fanIn: row.fan_in,
          importance: Math.round(row.importance * 100) / 100,
          churn: row.change_count,
        },
      ];
    }),
  );
}

function defined(facts: Partial<FileFacts>): Partial<FileFacts> {
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== null && value !== undefined),
  );
}

export async function loadFileFacts(
  db: Queryable,
  root: string,
  paths: readonly string[],
  scanned: readonly RankedFile[],
): Promise<Map<string, FileFacts>> {
  const wanted = factPaths(paths);
  if (wanted.length === 0) return new Map();
  const scan = new Map(scanned.map((file) => [file.path, fromScan(file)]));
  const [index, map] = await Promise.all([
    indexFacts(db, root, wanted).catch(() => new Map<string, Partial<FileFacts>>()),
    mapFacts(db, root, wanted).catch(() => new Map<string, Partial<FileFacts>>()),
  ]);
  return new Map(
    wanted.map((path) => [
      path,
      {
        ...EMPTY,
        ...defined(index.get(path) ?? {}),
        ...defined(map.get(path) ?? {}),
        ...defined(scan.get(path) ?? {}),
      },
    ]),
  );
}
