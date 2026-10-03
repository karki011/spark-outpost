import type { MapFileKind } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { nameCandidates } from './label-questions.ts';

export interface FileArea {
  area: string;
  kind: MapFileKind;
}

interface FileAreaRow {
  path: string;
  kind: MapFileKind;
  root: string;
  package: string;
  top_files: string[];
  label_name: string | null;
}

export async function fileAreas(
  db: Queryable,
  root: string,
  paths: readonly string[],
): Promise<Map<string, FileArea>> {
  if (paths.length === 0) return new Map();
  const { rows } = await db.query<FileAreaRow>(
    `SELECT f.path, f.kind, a.root, a.package, a.top_files, l.name AS label_name
     FROM map_files f
     JOIN map_repos r ON r.id = f.repo_id
     JOIN map_areas a ON a.repo_id = f.repo_id AND a.id = f.area_id
     LEFT JOIN map_labels l ON l.repo_id = a.repo_id AND l.area_id = a.id
     WHERE r.root_path = $1 AND f.path = ANY($2::text[])`,
    [root, paths],
  );
  return new Map(
    rows.map((row) => [
      row.path,
      {
        area: row.label_name ?? nameCandidates(row.root, row.package, row.top_files)[0] ?? row.root,
        kind: row.kind,
      },
    ]),
  );
}
