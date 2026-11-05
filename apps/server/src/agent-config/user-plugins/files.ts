import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_FILE_BYTES } from '../discovery.ts';
import { fingerprintOf } from '../fingerprint.ts';

export interface PluginFile {
  path: string;
  executable: boolean;
  bytes: Buffer;
  text: string | null;
}

export interface PluginFiles {
  files: PluginFile[];
  symlinks: string[];
  tooLarge: string | null;
}

export const MAX_PLUGIN_FILES = 2_000;
export const MAX_PLUGIN_BYTES = 20 * 1024 * 1024;
const MAX_DEPTH = 12;
const SKIPPED_DIRS = new Set(['.git', '.in_use']);

function textOf(bytes: Buffer): string | null {
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) return null;
  return bytes.toString('utf8');
}

interface StatEntry {
  path: string;
  size: number;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}

export interface PluginStats {
  entries: StatEntry[];
  symlinks: string[];
  tooLarge: string | null;
}

interface Walk {
  root: string;
  found: PluginStats;
  total: number;
}

const LIMIT_REASON = `It has more than ${MAX_PLUGIN_FILES} files or ${MAX_PLUGIN_BYTES / 1024 / 1024} MB, so Spark can't check it.`;

async function walk(state: Walk, dir: string, depth: number): Promise<void> {
  if (state.found.tooLarge) return;
  if (depth > MAX_DEPTH) {
    state.found.tooLarge = `Its folders are nested more than ${MAX_DEPTH} deep, so Spark can't check it.`;
    return;
  }
  const entries = await readdir(join(state.root, dir), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    const info = await lstat(join(state.root, path));
    if (info.isSymbolicLink()) state.found.symlinks.push(path);
    else if (info.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await walk(state, path, depth + 1);
    } else if (info.isFile()) {
      state.total += info.size;
      if (state.found.entries.length >= MAX_PLUGIN_FILES || state.total > MAX_PLUGIN_BYTES) {
        state.found.tooLarge = LIMIT_REASON;
        return;
      }
      const { size, mode, mtimeMs, ctimeMs, ino } = info;
      state.found.entries.push({ path, size, mode, mtimeMs, ctimeMs, ino });
    }
    if (state.found.tooLarge) return;
  }
}

export async function statPluginFiles(root: string): Promise<PluginStats> {
  const state: Walk = { root, found: { entries: [], symlinks: [], tooLarge: null }, total: 0 };
  await walk(state, '', 0);
  return state.found;
}

export function statsSignature(stats: PluginStats): string {
  return fingerprintOf([
    stats.entries.map(({ path, size, mode, mtimeMs, ctimeMs, ino }) => [
      path,
      size,
      mode,
      mtimeMs,
      ctimeMs,
      ino,
    ]),
    stats.symlinks,
    stats.tooLarge,
  ]);
}

export async function readStatedFiles(root: string, stats: PluginStats): Promise<PluginFiles> {
  const files: PluginFile[] = [];
  for (const entry of stats.entries) {
    const bytes = await readFile(join(root, entry.path));
    files.push({
      path: entry.path,
      executable: (entry.mode & 0o111) !== 0,
      bytes,
      text: textOf(bytes),
    });
  }
  return { files, symlinks: stats.symlinks, tooLarge: stats.tooLarge };
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function filesFingerprint(found: PluginFiles): string {
  return fingerprintOf([
    found.files.map((file) => [file.path, file.executable, digest(file.bytes)]),
    found.symlinks,
    found.tooLarge,
  ]);
}
