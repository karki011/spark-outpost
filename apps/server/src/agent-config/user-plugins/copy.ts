import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pluginName } from '../plugin-dir.ts';
import { isRecord } from '../records.ts';
import {
  filesFingerprint,
  readStatedFiles,
  statPluginFiles,
  statsSignature,
  type PluginFile,
  type PluginFiles,
} from './files.ts';
import type { UserPluginLaunch } from './launch.ts';

const MANIFESTS = new Set(['.claude-plugin/plugin.json', 'plugin.json']);
const WIDENING_FIELD = /^(?:allowed-tools|allowedTools|permissionMode|permission-mode)\s*:/;
const FENCE = /^---\r?\n([\s\S]*?\r?\n)---[ \t]*(?:\r?\n|$)/;

export function withoutWideningFields(text: string): string {
  const header = FENCE.exec(text)?.[1];
  if (header === undefined) return text;
  const kept: string[] = [];
  let dropping = false;
  for (const line of header.split(/(?<=\n)/)) {
    if (!/^[ \t]/.test(line)) dropping = WIDENING_FIELD.test(line);
    if (!dropping) kept.push(line);
  }
  const start = text.indexOf('\n') + 1;
  return text.slice(0, start) + kept.join('') + text.slice(start + header.length);
}

function withoutHooksKey(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !('hooks' in parsed)) return text;
    return JSON.stringify(
      Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'hooks')),
      null,
      2,
    );
  } catch {
    return text;
  }
}

function rewritten(file: PluginFile, text: string): PluginFile {
  return text === file.text ? file : { ...file, bytes: Buffer.from(text), text };
}

export function pluginCopyFiles(plugin: UserPluginLaunch): PluginFiles {
  const hookFiles = new Set(plugin.parsed.hookFiles);
  const definitions = new Set(plugin.parsed.definitionFiles);
  const files = plugin.files.flatMap((file) => {
    if (hookFiles.has(file.path)) return [];
    if (file.text === null) return [file];
    if (MANIFESTS.has(file.path)) return [rewritten(file, withoutHooksKey(file.text))];
    if (definitions.has(file.path)) return [rewritten(file, withoutWideningFields(file.text))];
    return [file];
  });
  return { files, symlinks: [], tooLarge: null };
}

const verifiedCopies = new Map<string, string>();

async function matches(target: string, expected: string): Promise<boolean> {
  try {
    const stats = await statPluginFiles(target);
    const signature = statsSignature(stats);
    if (verifiedCopies.get(target) === signature) return true;
    const same = filesFingerprint(await readStatedFiles(target, stats)) === expected;
    if (same) verifiedCopies.set(target, signature);
    else verifiedCopies.delete(target);
    return same;
  } catch {
    verifiedCopies.delete(target);
    return false;
  }
}

async function writeAll(dir: string, files: readonly PluginFile[]): Promise<void> {
  for (const file of files) {
    const path = join(dir, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
    await chmod(path, file.executable ? 0o755 : 0o644);
  }
}

async function placeCopy(staging: string, holder: string, target: string, expected: string) {
  try {
    await rename(staging, holder);
  } catch {
    if (await matches(target, expected)) return;
    await rm(holder, { recursive: true, force: true });
    await rename(staging, holder);
  }
}

export async function writeUserPluginDir(
  plugin: UserPluginLaunch,
  base = join(tmpdir(), 'spark-outpost-user-plugins'),
): Promise<string> {
  const copy = pluginCopyFiles(plugin);
  const expected = filesFingerprint(copy);
  const folder = pluginName(plugin.name, new Set());
  const holder = join(base, expected);
  const target = join(holder, folder);
  if (await matches(target, expected)) return target;
  const staging = join(base, `.staging-${randomUUID()}`);
  try {
    await writeAll(join(staging, folder), copy.files);
    await placeCopy(staging, holder, target, expected);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return target;
}
