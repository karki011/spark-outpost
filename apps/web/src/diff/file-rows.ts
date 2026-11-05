import type { ChangeFolder } from '@spark-outpost/contracts';

export interface FolderRow {
  kind: 'folder';
  path: string;
  count: number;
  collapsed: boolean;
  level: 1;
  position: number;
  setSize: number;
}

export interface FileRow {
  kind: 'file';
  index: number;
  level: 1 | 2;
  position: number;
  setSize: number;
  folder: string | null;
}

export type TreeRow = FolderRow | FileRow;

export interface RowModel {
  count: number;
  at(row: number): TreeRow;
  rowOfFile(index: number): number | null;
}

export function flatRows(total: number): RowModel {
  return {
    count: total,
    at: (row) => ({
      kind: 'file',
      index: row,
      level: 1,
      position: row + 1,
      setSize: total,
      folder: null,
    }),
    rowOfFile: (index) => (index >= 0 && index < total ? index : null),
  };
}

export function groupedRows(
  folders: readonly ChangeFolder[],
  collapsed: ReadonlySet<string>,
): RowModel {
  const rows: TreeRow[] = [];
  const fileRows = new Map<number, number>();
  folders.forEach((folder, folderIndex) => {
    const shut = collapsed.has(folder.path);
    rows.push({
      kind: 'folder',
      path: folder.path,
      count: folder.count,
      collapsed: shut,
      level: 1,
      position: folderIndex + 1,
      setSize: folders.length,
    });
    if (shut) return;
    for (let offset = 0; offset < folder.count; offset++) {
      fileRows.set(folder.start + offset, rows.length);
      rows.push({
        kind: 'file',
        index: folder.start + offset,
        level: 2,
        position: offset + 1,
        setSize: folder.count,
        folder: folder.path,
      });
    }
  });
  return {
    count: rows.length,
    at: (row) => rows[row]!,
    rowOfFile: (index) => fileRows.get(index) ?? null,
  };
}

export function fileIndexAt(model: RowModel, row: number): number | null {
  const found = model.at(row);
  return found.kind === 'file' ? found.index : null;
}

export function parentRow(model: RowModel, row: number): number | null {
  const found = model.at(row);
  if (found.kind !== 'file' || found.folder === null) return null;
  return row - found.position;
}
