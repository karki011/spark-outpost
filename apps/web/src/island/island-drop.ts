import { isSecretFileName } from '@spark-outpost/contracts';
import { classifyFile } from '../api/attachments.ts';

export type DropKind = 'image' | 'file' | 'folder';

export interface DropItem {
  kind: DropKind;
  name: string;
  file: File;
}

export interface SortedDrop {
  files: File[];
  folders: string[];
  shown: DropItem | null;
  notes: string[];
  rejectedAll: boolean;
}

function isFolder(transfer: DataTransfer, index: number): boolean {
  return transfer.items[index]?.webkitGetAsEntry?.()?.isDirectory ?? false;
}

function itemOf(file: File, folder: boolean): DropItem {
  if (folder) return { kind: 'folder', name: file.name, file };
  return { kind: file.type.startsWith('image/') ? 'image' : 'file', name: file.name, file };
}

export function sortDrop(
  files: readonly File[],
  transfer: DataTransfer,
  pathOf: (file: File) => string | null,
): SortedDrop {
  const accepted: DropItem[] = [];
  const rejected: DropItem[] = [];
  const secrets: string[] = [];
  const homeless: string[] = [];
  const folders: string[] = [];
  files.forEach((file, index) => {
    const folder = isFolder(transfer, index);
    const item = itemOf(file, folder);
    if (folder) {
      const folderPath = pathOf(file);
      if (folderPath) {
        folders.push(folderPath);
        accepted.push(item);
      } else {
        homeless.push(file.name);
        rejected.push(item);
      }
      return;
    }
    if (isSecretFileName(file.name)) {
      secrets.push(file.name);
      rejected.push(item);
      return;
    }
    if ('error' in classifyFile(file)) rejected.push(item);
    else accepted.push(item);
  });
  const notes = [
    secrets.length > 0 ? `Skipped ${secrets.join(', ')}: Spark never reads secret files.` : null,
    homeless.length > 0 ? 'Drop folders in the Mac app to link them as a project.' : null,
  ].filter((note): note is string => note !== null);
  return {
    files: files.filter(
      (file, index) => !isFolder(transfer, index) && !isSecretFileName(file.name),
    ),
    folders,
    shown: accepted[0] ?? rejected[0] ?? null,
    notes,
    rejectedAll: accepted.length === 0,
  };
}
