import { realpathSync } from 'node:fs';
import path from 'node:path';
import { sparkDataDir } from '../config.ts';
import { globToRegExp } from '../projects/path-policy.ts';
import { sparkRulesFiles, type SparkRulesFiles } from '../spark-rules/rules-store.ts';
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

export const SPARK_RULES_REASON =
  "Spark's own rules (settings.json in Spark's data folder, or the company's managed-settings.json) can't be read or changed by an agent; the user changes them";

export function sparkRulesEntries(files: SparkRulesFiles = sparkRulesFiles()): string[] {
  return [path.resolve(files.user), path.resolve(files.managed)];
}

export function entryPath(dataDir: string, entry: string): string {
  return path.isAbsolute(entry) ? entry : path.join(dataDir, entry);
}

export function guardedDataEntries(): string[] {
  return [...BROWSER_DATA_ENTRIES, ...sparkRulesEntries()];
}

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

type Entries = readonly string[];

function protectedEntries(dataDir: string, entries: Entries): string[] {
  return entries.map((entry) => comparable(entryPath(dataDir, entry)));
}

function isEntry(target: string, dataDir: string, entries: Entries, whole: boolean): boolean {
  const folder = comparable(dataDir);
  const wanted = comparable(target);
  if (whole && wanted === folder) return true;
  return protectedEntries(dataDir, entries).some((entry) => within(entry, wanted));
}

export function isBrowserData(target: string, dataDir: string): boolean {
  return isEntry(target, dataDir, BROWSER_DATA_ENTRIES, true);
}

export function globReachesBrowserData(
  word: string,
  cwd: string,
  home: string,
  dataDir: string,
  entries: Entries = BROWSER_DATA_ENTRIES,
): boolean {
  const expanded = word === '~' || word.startsWith('~/') ? path.join(home, word.slice(1)) : word;
  const wild = expanded.search(GLOB);
  if (wild < 0) return false;
  const staticPart = expanded.slice(0, wild);
  const slash = staticPart.lastIndexOf('/');
  const parent = comparable(path.resolve(cwd, slash < 0 ? '.' : staticPart.slice(0, slash) || '/'));
  const prefix = caseFolded(staticPart.slice(slash + 1));
  const named = [comparable(dataDir), ...protectedEntries(dataDir, entries)];
  return named.some((entry) => {
    if (within(entry, parent)) return entry !== comparable(dataDir);
    const relative = path.relative(parent, entry);
    if (relative === '' || relative.startsWith('..') || relative.includes(path.sep)) return false;
    return relative.startsWith(prefix);
  });
}

function widenedGlob(word: string): string {
  return word.replace(/\[[^\]/]*\]/g, '?').replace(/\{[^}/]*\}/g, '*');
}

function globNamesEntry(
  word: string,
  cwd: string,
  home: string,
  dataDir: string,
  entries: Entries,
): boolean {
  const expanded = word === '~' || word.startsWith('~/') ? path.join(home, word.slice(1)) : word;
  if (expanded.search(GLOB) < 0) return false;
  const pattern = globToRegExp(comparable(path.resolve(cwd, widenedGlob(expanded))));
  return protectedEntries(dataDir, entries).some((entry) => pattern.test(entry));
}

export function sparkRulesFlagRules(files: SparkRulesFiles = sparkRulesFiles()): string[] {
  const patterns = sparkRulesEntries(files).map((file) => `/${file}`);
  return patterns.flatMap((pattern) => [`Read(${pattern})`, `Edit(${pattern})`]);
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

function namesAnEntry(command: string, dataDir: string, entries: Entries): boolean {
  const text = caseFolded(command);
  return entries.some((entry) => text.includes(caseFolded(entryPath(dataDir, entry))));
}

function wordPaths(word: string): string[] {
  const assigned = word.indexOf('=');
  const value = assigned < 0 ? '' : word.slice(assigned + 1);
  return [word, value].filter((part) => part !== '');
}

function touchesEntries(
  request: ApprovalRequest,
  dataDir: string,
  entries: Entries,
  whole: boolean,
): boolean {
  if (request.paths.some((target) => isEntry(target, dataDir, entries, whole))) return true;
  if (!request.command) return false;
  if (namesAnEntry(request.command, dataDir, entries)) return true;
  const cwd = commandCwd(request);
  const words = treeWords(commandTree(request.command)).flatMap(wordPaths);
  return words.some(
    (word) =>
      isEntry(resolveCommandPath(word, cwd, request.home), dataDir, entries, whole) ||
      globReachesBrowserData(word, cwd, request.home, dataDir, entries) ||
      globNamesEntry(word, cwd, request.home, dataDir, entries),
  );
}

export function touchesBrowserData(request: ApprovalRequest, dataDir: string | null): boolean {
  return dataDir !== null && touchesEntries(request, dataDir, BROWSER_DATA_ENTRIES, true);
}

export function touchesSparkRules(
  request: ApprovalRequest,
  files: SparkRulesFiles = sparkRulesFiles(),
): boolean {
  return touchesEntries(request, '/', sparkRulesEntries(files), false);
}
