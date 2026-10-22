import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, sep } from 'node:path';
import { withTransaction, type Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import { assertLeaseHeld, LeaseLostError } from '../persistence/run-events.ts';
import { chatKeptFolder, chatWorkFolder } from './folders.ts';
import {
  CHAT_FILE_PATH_MAX,
  insertChatFile,
  knownChatFiles,
  type KnownFile,
  type NewChatFile,
} from './store.ts';

export const KEPT_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const FILES_PER_TURN = 100;
const FILES_SCANNED = 5000;
const SKIPPED_FOLDERS = new Set(['node_modules', '__pycache__', 'venv']);

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.txt': 'text/plain',
};

export function mediaTypeOf(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function walk(root: string, relative: string, found: string[]): Promise<void> {
  if (found.length >= FILES_SCANNED) return;
  const entries = await readdir(join(root, relative), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (path.length > CHAT_FILE_PATH_MAX) continue;
    if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) await walk(root, path, found);
    if (!entry.isFile()) continue;
    found.push(path);
    if (found.length >= FILES_SCANNED) return;
  }
}

function within(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function stillInside(root: string, path: string, opened: Stats): Promise<boolean> {
  const folder = await realpath(dirname(path)).catch(() => null);
  if (!folder || !within(root, folder)) return false;
  const named = await lstat(path).catch(() => null);
  return named !== null && named.dev === opened.dev && named.ino === opened.ino;
}

export interface InsideFile {
  data: Buffer;
  changedMs: number;
}

export async function readInside(root: string, relative: string): Promise<InsideFile | null> {
  const path = join(root, relative);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) return null;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > KEPT_FILE_MAX_BYTES) return null;
    if (!(await stillInside(root, path, stats))) return null;
    return { data: await handle.readFile(), changedMs: stats.ctimeMs };
  } finally {
    await handle.close();
  }
}

async function changedSince(root: string, relative: string, known: KnownFile | undefined) {
  if (!known) return true;
  const stats = await lstat(join(root, relative)).catch(() => null);
  return stats === null || stats.size !== known.size || stats.ctimeMs !== known.changedMs;
}

export interface ChatFilesTurn {
  db: Db;
  base: string;
  conversationId: string;
  lease: Lease;
}

async function keepOne(turn: ChatFilesTurn, kept: string, file: NewChatFile, data: Buffer) {
  await mkdir(kept, { recursive: true, mode: 0o700 });
  const copy = join(kept, file.id);
  await writeFile(copy, data, { mode: 0o600, flag: 'wx' });
  try {
    await withTransaction(turn.db, async (client) => {
      await assertLeaseHeld(client, turn.lease, false);
      await insertChatFile(client, turn.conversationId, turn.lease.runId, file);
    });
  } catch (error) {
    await rm(copy, { force: true });
    throw error;
  }
}

export async function recordChatFiles(turn: ChatFilesTurn): Promise<number> {
  const work = await realpath(chatWorkFolder(turn.base, turn.conversationId));
  const kept = chatKeptFolder(turn.base, turn.conversationId);
  const known = await knownChatFiles(turn.db, turn.conversationId);
  const found: string[] = [];
  await walk(work, '', found);
  const failures: unknown[] = [];
  let added = 0;
  for (const path of found) {
    if (added >= FILES_PER_TURN) break;
    const before = known.get(path);
    if (!(await changedSince(work, path, before))) continue;
    const read = await readInside(work, path);
    if (!read) continue;
    const sha256 = createHash('sha256').update(read.data).digest('hex');
    if (before?.sha256 === sha256 && before.size === read.data.length) continue;
    const file = {
      id: randomUUID(),
      path,
      size: read.data.length,
      changedMs: read.changedMs,
      sha256,
      mediaType: mediaTypeOf(path),
    };
    try {
      await keepOne(turn, kept, file, read.data);
      added += 1;
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Some files could not be kept');
  return added;
}
