export interface PatchHunk {
  oldStart: number;
  added: number;
  removed: number;
}

export interface PatchFile {
  path: string;
  created: boolean;
  deleted: boolean;
  added: string[];
  removed: string[];
  hunks: PatchHunk[];
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/;

function newFile(path: string): PatchFile {
  return { path, created: false, deleted: false, added: [], removed: [], hunks: [] };
}

export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let hunk: PatchHunk | null = null;
  for (const line of patch.split('\n')) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      file = newFile(header[2]!);
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const range = HUNK_HEADER.exec(line);
    if (range) {
      hunk = { oldStart: Number(range[1]), added: 0, removed: 0 };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (line.startsWith('deleted file mode')) file.deleted = true;
      if (line.startsWith('new file mode')) file.created = true;
      continue;
    }
    if (line.startsWith('+')) {
      file.added.push(line.slice(1));
      hunk.added += 1;
    } else if (line.startsWith('-')) {
      file.removed.push(line.slice(1));
      hunk.removed += 1;
    }
  }
  return files;
}

export function baseName(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  return name.replace(/\.[^.]+$/, '');
}

export function dirName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

export function mentions(text: string, word: string): boolean {
  if (!word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'i').test(text);
}

export const SNAPSHOT_FILE = /(?:^|\/)__snapshots__\/|\.snap$/;
