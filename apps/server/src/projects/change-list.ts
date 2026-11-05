import { execFile, spawn } from 'node:child_process';
import {
  DIFF_HUGE_BYTES,
  DIFF_MAX_BYTES,
  type ChangedFile,
  type RunChange,
} from '@spark-outpost/contracts';
import { git } from './snapshot.ts';
import { sendInput } from './child-input.ts';

export interface FileContents {
  before: Buffer | null;
  after: Buffer | null;
}

export interface ListedFile {
  file: ChangedFile;
  revision?: string;
  blobs?: { before: string | null; after: string | null };
  contents(): Promise<FileContents>;
}

interface RawChange {
  change: RunChange['change'];
  path: string;
  oldPath?: string;
  oldBlob: string | null;
  newBlob: string | null;
}

interface NumstatEntry {
  added: number | null;
  removed: number | null;
}

const GIT_TIMEOUT_MS = 60_000;
const ZERO_BLOB = /^0+$/;
const RAW_CODES: Record<string, RunChange['change']> = {
  A: 'added',
  C: 'added',
  M: 'modified',
  T: 'modified',
  R: 'modified',
  D: 'deleted',
};

function blob(sha: string | undefined): string | null {
  return !sha || ZERO_BLOB.test(sha) ? null : sha;
}

export function parseRawDiff(output: string): RawChange[] {
  const parts = output.split('\0');
  const changes: RawChange[] = [];
  let index = 0;
  while (index < parts.length) {
    const header = parts[index++]!;
    if (!header.startsWith(':')) continue;
    const [, , oldSha, newSha, status = ''] = header.slice(1).split(' ');
    const code = status.charAt(0);
    const paired = code === 'R' || code === 'C';
    const first = parts[index++] ?? '';
    const second = paired ? (parts[index++] ?? '') : null;
    const change = RAW_CODES[code];
    if (!change) continue;
    changes.push({
      change,
      path: second ?? first,
      ...(code === 'R' ? { oldPath: first } : {}),
      oldBlob: blob(oldSha),
      newBlob: blob(newSha),
    });
  }
  return changes;
}

function count(value: string | undefined): number | null {
  return value === undefined || value === '-' ? null : Number(value);
}

export function parseNumstatZ(output: string): Map<string, NumstatEntry> {
  const parts = output.split('\0');
  const counts = new Map<string, NumstatEntry>();
  let index = 0;
  while (index < parts.length) {
    const line = parts[index++]!;
    if (line === '') continue;
    const [added, removed, path = ''] = line.split('\t');
    let target = path;
    if (target === '') {
      index++;
      target = parts[index++] ?? '';
    }
    counts.set(target, { added: count(added), removed: count(removed) });
  }
  return counts;
}

function objectSizes(root: string, shas: readonly string[]): Promise<Map<string, number>> {
  if (shas.length === 0) return Promise.resolve(new Map());
  return new Promise((resolve, reject) => {
    const child = spawn('git', [
      '-C',
      root,
      'cat-file',
      '--batch-check=%(objectname) %(objectsize)',
    ]);
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (output += chunk));
    child.on('error', reject);
    child.on('close', () => {
      const sizes = new Map<string, number>();
      for (const line of output.split('\n')) {
        const [sha, size] = line.split(' ');
        if (sha && size && /^\d+$/.test(size)) sizes.set(sha, Number(size));
      }
      resolve(sizes);
    });
    sendInput(child, `${shas.join('\n')}\n`);
  });
}

export function shownFor(binary: boolean, bytes: number): ChangedFile['shown'] {
  if (binary) return 'binary';
  return bytes > DIFF_HUGE_BYTES ? 'too-large' : 'text';
}

export function describeRaw(
  raw: RawChange,
  counts: NumstatEntry | undefined,
  sizes: ReadonlyMap<string, number>,
): ChangedFile {
  const added = counts?.added ?? null;
  const removed = counts?.removed ?? null;
  const binary = counts !== undefined && added === null;
  const bytes = Math.max(
    raw.oldBlob ? (sizes.get(raw.oldBlob) ?? 0) : 0,
    raw.newBlob ? (sizes.get(raw.newBlob) ?? 0) : 0,
  );
  const shown = shownFor(binary, bytes);
  return {
    path: raw.path,
    change: raw.change,
    ...(raw.oldPath ? { oldPath: raw.oldPath } : {}),
    added,
    removed,
    oldText: null,
    newText: null,
    shown,
    ...(shown === 'too-large' ? { truncated: true } : {}),
    bytes,
  };
}

interface GitRange {
  root: string;
  from: string;
  to: string;
}

function readBlob(root: string, sha: string | null): Promise<Buffer | null> {
  if (sha === null) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', root, 'cat-file', 'blob', sha],
      { encoding: 'buffer', maxBuffer: DIFF_MAX_BYTES * 2, timeout: GIT_TIMEOUT_MS },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export async function gitRangeFiles(range: GitRange): Promise<ListedFile[]> {
  const { root, from, to } = range;
  const [rawOutput, numstat] = await Promise.all([
    git(root, ['diff', '--raw', '--no-abbrev', '-M', '-z', '--relative', from, to]),
    git(root, ['diff', '--numstat', '-M', '-z', '--relative', from, to]),
  ]);
  const raws = parseRawDiff(rawOutput);
  const counts = parseNumstatZ(numstat);
  const shas = [...new Set(raws.flatMap((raw) => [raw.oldBlob, raw.newBlob]))].filter(
    (sha): sha is string => sha !== null,
  );
  const sizes = await objectSizes(root, shas);
  return raws.map((raw) => ({
    file: describeRaw(raw, counts.get(raw.path), sizes),
    revision: `${raw.oldBlob ?? '-'}..${raw.newBlob ?? '-'}`,
    blobs: { before: raw.oldBlob, after: raw.newBlob },
    contents: async () => {
      const [before, after] = await Promise.all([
        readBlob(root, raw.oldBlob),
        readBlob(root, raw.newBlob),
      ]);
      return { before, after };
    },
  }));
}
