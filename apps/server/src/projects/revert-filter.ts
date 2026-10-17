import type { RevertedFile } from '@spark-outpost/contracts';
import type { FileRevert } from '../persistence/file-reverts.ts';
import type { ListedFile } from './change-list.ts';

export type RevertsByPath = ReadonlyMap<string, Pick<FileRevert, 'beforeBlob' | 'afterBlob'>>;

export function revertsByPath(reverts: readonly FileRevert[]): RevertsByPath {
  return new Map(reverts.map((revert) => [revert.path, revert]));
}

export function undoesRevert(listed: ListedFile, earlier: RevertsByPath): boolean {
  const { blobs, file } = listed;
  if (!blobs) return false;
  const from = earlier.get(file.oldPath ?? file.path);
  const to = earlier.get(file.path);
  if (!from || !to) return false;
  if (from.beforeBlob !== blobs.before || to.afterBlob !== blobs.after) return false;
  if (file.oldPath === undefined) return true;
  return from.afterBlob === null && to.beforeBlob === null;
}

function touches(listed: ListedFile, paths: ReadonlySet<string>): boolean {
  const { path, oldPath } = listed.file;
  return paths.has(path) || (oldPath !== undefined && paths.has(oldPath));
}

export interface RevertView {
  own: readonly FileRevert[];
  earlier: RevertsByPath;
  fixedRange: boolean;
}

export function withoutReverted(files: readonly ListedFile[], view: RevertView): ListedFile[] {
  const own = new Set(view.own.map((revert) => revert.path));
  return files.filter((listed) => {
    if (view.fixedRange && touches(listed, own)) return false;
    return !undoesRevert(listed, view.earlier);
  });
}

export function revertedFiles(reverts: readonly FileRevert[]): RevertedFile[] {
  return reverts.map((revert) => ({
    path: revert.path,
    revertedAt: revert.revertedAt.toISOString(),
  }));
}
