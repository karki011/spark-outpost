import { realpathSync } from 'node:fs';
import path from 'node:path';
import { sparkDataDir } from '../config.ts';
import { commandTree, treeWords } from './command-tree.ts';
import { resolveCommandPath } from './commands.ts';
import type { ApprovalRequest } from './decide.ts';
import { commandCwd } from './request-place.ts';

export const BROWSER_DATA_REASON =
  "Spark's browser data (Browser pane profiles, the app's own cookies and storage, history and the database holding it) can't be read, copied or changed by an agent";

export const BROWSER_DATA_ENTRIES = [
  'Partitions',
  'browser-view.json',
  'browser-origins.json',
  'postgres',
  'postgres-password',
  'backups',
  'Cookies',
  'Cookies-journal',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'WebStorage',
  'Service Worker',
  'Shared Dictionary',
  'Trust Tokens',
  'Trust Tokens-journal',
  'DIPS',
  'DIPS-wal',
  'Network Persistent State',
  'Local State',
  'blob_storage',
  'Cache',
  'Code Cache',
  'web-storage.json',
] as const;

const GLOB = /[*?[{]/;

export function browserDataDir(
  env: NodeJS.ProcessEnv = process.env,
  fromCheckout?: boolean,
): string {
  const dataDir = sparkDataDir({ SPARK_DATA_DIR: env.SPARK_DATA_DIR }, fromCheckout);
  try {
    return realpathSync(dataDir);
  } catch {
    return path.resolve(dataDir);
  }
}

function caseFolded(text: string): string {
  return process.platform === 'darwin' ? text.toLowerCase() : text;
}

function comparable(target: string): string {
  return caseFolded(path.resolve(target).replace(/^\/(tmp|var)(?=\/|$)/, '/private/$1'));
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function protectedEntries(dataDir: string): string[] {
  return BROWSER_DATA_ENTRIES.map((entry) => comparable(path.join(dataDir, entry)));
}

export function isBrowserData(target: string, dataDir: string): boolean {
  const folder = comparable(dataDir);
  const wanted = comparable(target);
  if (wanted === folder) return true;
  return protectedEntries(dataDir).some((entry) => within(entry, wanted));
}

export function globReachesBrowserData(
  word: string,
  cwd: string,
  home: string,
  dataDir: string,
): boolean {
  const expanded = word === '~' || word.startsWith('~/') ? path.join(home, word.slice(1)) : word;
  const wild = expanded.search(GLOB);
  if (wild < 0) return false;
  const staticPart = expanded.slice(0, wild);
  const slash = staticPart.lastIndexOf('/');
  const parent = comparable(path.resolve(cwd, slash < 0 ? '.' : staticPart.slice(0, slash) || '/'));
  const prefix = caseFolded(staticPart.slice(slash + 1));
  const named = [comparable(dataDir), ...protectedEntries(dataDir)];
  return named.some((entry) => {
    if (within(entry, parent)) return entry !== comparable(dataDir);
    const relative = path.relative(parent, entry);
    if (relative === '' || relative.startsWith('..') || relative.includes(path.sep)) return false;
    return relative.startsWith(prefix);
  });
}

export function browserDataRules(dataDir: string | null): string[] {
  if (!dataDir) return [];
  const patterns = BROWSER_DATA_ENTRIES.map((entry) => `/${dataDir}/${entry}`);
  return patterns.flatMap((pattern) => [
    `Read(${pattern})`,
    `Read(${pattern}/**)`,
    `Edit(${pattern})`,
    `Edit(${pattern}/**)`,
  ]);
}

function namesAnEntry(command: string, dataDir: string): boolean {
  const text = caseFolded(command);
  return BROWSER_DATA_ENTRIES.some((entry) => text.includes(caseFolded(path.join(dataDir, entry))));
}

function wordPaths(word: string): string[] {
  const assigned = word.indexOf('=');
  const value = assigned < 0 ? '' : word.slice(assigned + 1);
  return [word, value].filter((part) => part !== '');
}

export function touchesBrowserData(request: ApprovalRequest, dataDir: string | null): boolean {
  if (!dataDir) return false;
  if (request.paths.some((target) => isBrowserData(target, dataDir))) return true;
  if (!request.command) return false;
  if (namesAnEntry(request.command, dataDir)) return true;
  const cwd = commandCwd(request);
  const words = treeWords(commandTree(request.command)).flatMap(wordPaths);
  return words.some(
    (word) =>
      isBrowserData(resolveCommandPath(word, cwd, request.home), dataDir) ||
      globReachesBrowserData(word, cwd, request.home, dataDir),
  );
}
