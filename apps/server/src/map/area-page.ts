import type { MapArea } from '@spark-outpost/contracts';
import { declarationsIn } from '../codescan/scan-store.ts';
import type { Queryable } from '../persistence/db.ts';
import { readAreaNote, type AreaNote } from './area-notes.ts';

const ENTRY_POINTS = 12;
const ENTRY_FILES = 8;
const RELATED_AREAS = 8;

export interface AreaEntryPoint {
  name: string;
  kind: string;
  file: string;
  lines: string;
  usedByFiles: number;
}

export interface RelatedArea {
  name: string;
  imports: number;
}

export interface AreaPage {
  area: MapArea;
  entryPoints: AreaEntryPoint[];
  dependsOn: RelatedArea[];
  usedBy: RelatedArea[];
  note: AreaNote | null;
}

export function matchArea(areas: readonly MapArea[], reference: string): MapArea | null {
  const wanted = reference.trim().toLowerCase();
  return (
    areas.find((area) => area.id === reference.trim()) ??
    areas.find((area) => area.name.toLowerCase() === wanted) ??
    areas.find((area) => area.root.toLowerCase() === wanted.replace(/\/$/, '')) ??
    null
  );
}

async function entryPoints(db: Queryable, root: string, area: MapArea): Promise<AreaEntryPoint[]> {
  const files = area.topFiles.slice(0, ENTRY_FILES);
  const declared = await declarationsIn(db, root, files);
  return files
    .flatMap((file) =>
      (declared.get(file) ?? []).map((declaration) => ({
        name: declaration.name,
        kind: declaration.kind,
        file,
        lines: `${declaration.startLine}-${declaration.endLine}`,
        usedByFiles: declaration.refFiles,
      })),
    )
    .toSorted((a, b) => b.usedByFiles - a.usedByFiles)
    .slice(0, ENTRY_POINTS);
}

interface EdgeRow {
  from_area: string;
  to_area: string;
  weight: number;
}

function related(
  rows: readonly EdgeRow[],
  pick: (row: EdgeRow) => string,
  names: ReadonlyMap<string, string>,
): RelatedArea[] {
  return rows
    .toSorted((a, b) => b.weight - a.weight)
    .slice(0, RELATED_AREAS)
    .map((row) => ({ name: names.get(pick(row)) ?? pick(row), imports: row.weight }));
}

export async function areaPage(
  db: Queryable,
  root: string,
  areas: readonly MapArea[],
  area: MapArea,
): Promise<AreaPage> {
  const [points, edges, note] = await Promise.all([
    entryPoints(db, root, area),
    db.query<EdgeRow>(
      `SELECT e.from_area, e.to_area, e.weight
       FROM map_area_edges e JOIN map_repos r ON r.id = e.repo_id
       WHERE r.root_path = $1 AND (e.from_area = $2 OR e.to_area = $2)
         AND e.from_area <> e.to_area`,
      [root, area.id],
    ),
    readAreaNote(db, root, area.id),
  ]);
  const names = new Map(areas.map((each) => [each.id, each.name]));
  return {
    area,
    entryPoints: points,
    dependsOn: related(
      edges.rows.filter((row) => row.from_area === area.id),
      (row) => row.to_area,
      names,
    ),
    usedBy: related(
      edges.rows.filter((row) => row.to_area === area.id),
      (row) => row.from_area,
      names,
    ),
    note,
  };
}
