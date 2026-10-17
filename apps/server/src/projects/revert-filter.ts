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

export function revertedByRun(listed: ListedFile, own: RevertsByPath): boolean {
  const { blobs, file } = listed;
  if (!blobs) return false;
  const from = own.get(file.oldPath ?? file.path);
  const to = own.get(file.path);
  if (!from || !to) return false;
  return from.afterBlob === blobs.before && to.beforeBlob === blobs.after;
}

export interface RevertView {
  own: RevertsByPath;
  earlier: RevertsByPath;
}

export function withoutReverted(files: readonly ListedFile[], view: RevertView): ListedFile[] {
  return files.filter(
    (listed) => !revertedByRun(listed, view.own) && !undoesRevert(listed, view.earlier),
  );
}

export function revertedFiles(reverts: readonly FileRevert[]): RevertedFile[] {
  return reverts.map((revert) => ({
    path: revert.path,
    revertedAt: revert.revertedAt.toISOString(),
  }));
}
