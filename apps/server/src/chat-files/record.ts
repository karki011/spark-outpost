import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Queryable } from '../persistence/db.ts';
import { chatKeptFolder, chatWorkFolder } from './folders.ts';
import { insertChatFiles, knownChatFiles, type KnownFile, type NewChatFile } from './store.ts';

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
    if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) await walk(root, path, found);
    if (!entry.isFile()) continue;
    found.push(path);
    if (found.length >= FILES_SCANNED) return;
  }
}

async function readRegular(path: string): Promise<{ data: Buffer; modifiedMs: number } | null> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) return null;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > KEPT_FILE_MAX_BYTES) return null;
    const data = await handle.readFile();
    return { data, modifiedMs: stats.mtimeMs };
  } finally {
    await handle.close();
  }
}

function unchanged(known: KnownFile | undefined, size: number, modifiedMs: number): boolean {
  return known !== undefined && known.size === size && known.modifiedMs === modifiedMs;
}

async function statOf(path: string): Promise<{ size: number; modifiedMs: number } | null> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) return null;
  try {
    const stats = await handle.stat();
    return stats.isFile() ? { size: stats.size, modifiedMs: stats.mtimeMs } : null;
  } finally {
    await handle.close();
  }
}

export interface ChatFilesTurn {
  db: Queryable;
  base: string;
  conversationId: string;
  runId: string;
}

export async function recordChatFiles(turn: ChatFilesTurn): Promise<number> {
  const work = chatWorkFolder(turn.base, turn.conversationId);
  const kept = chatKeptFolder(turn.base, turn.conversationId);
  const known = await knownChatFiles(turn.db, turn.conversationId);
  const found: string[] = [];
  await walk(work, '', found);
  const added: NewChatFile[] = [];
  for (const path of found) {
    if (added.length >= FILES_PER_TURN) break;
    const absolute = join(work, path);
    const stat = await statOf(absolute);
    if (!stat || unchanged(known.get(path), stat.size, stat.modifiedMs)) continue;
    const read = await readRegular(absolute);
    if (!read) continue;
    const sha256 = createHash('sha256').update(read.data).digest('hex');
    const before = known.get(path);
    if (before?.sha256 === sha256 && before.size === read.data.length) continue;
    const id = randomUUID();
    await mkdir(kept, { recursive: true, mode: 0o700 });
    await writeFile(join(kept, id), read.data, { mode: 0o600, flag: 'wx' });
    added.push({
      id,
      path,
      size: read.data.length,
      modifiedMs: read.modifiedMs,
      sha256,
      mediaType: mediaTypeOf(path),
    });
  }
  await insertChatFiles(turn.db, turn.conversationId, turn.runId, added);
  return added.length;
}
