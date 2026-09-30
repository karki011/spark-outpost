import { posix } from 'node:path';
import { manifestName, type ReadText } from '../codescan/layout.ts';

export interface AliasScope {
  dir: string;
  baseUrl: string | null;
  pathsBase: string;
  paths: [string, string[]][];
}

export interface PackageEntry {
  name: string;
  root: string;
  entries: Map<string, string[]>;
}

export interface GoModule {
  module: string;
  root: string;
}

export interface ResolverConfig {
  aliases: AliasScope[];
  packages: PackageEntry[];
  goModules: GoModule[];
  pythonRoots: string[];
}

const TSCONFIG = /(?:^|\/)(?:tsconfig[^/]*|jsconfig)\.json$/;
const PYTHON_MANIFEST = /(?:^|\/)(?:pyproject\.toml|setup\.py|setup\.cfg)$/;
const ENTRY_CONDITIONS = ['source', 'types', 'import', 'module', 'default', 'require', 'node'];
const MAX_EXTENDS = 4;

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

function joinPath(base: string, relative: string): string {
  const joined = posix.normalize(posix.join(base, relative));
  return joined === '' ? '.' : joined.replace(/\/$/, '');
}

export function parseJsonc(text: string): unknown {
  const withoutComments = text.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, quoted: string | undefined) => quoted ?? '',
  );
  try {
    return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return null;
  }
}

interface CompilerOptions {
  baseUrl?: unknown;
  paths?: unknown;
}

interface ConfigFile {
  extends?: unknown;
  compilerOptions?: CompilerOptions;
}

interface ResolvedOptions {
  baseUrl: string | null;
  paths: [string, string[]][] | null;
  pathsBase: string;
}

function stringPaths(value: unknown): [string, string[]][] | null {
  if (!value || typeof value !== 'object') return null;
  return Object.entries(value as Record<string, unknown>).map(([pattern, targets]) => [
    pattern,
    Array.isArray(targets) ? targets.filter((target) => typeof target === 'string') : [],
  ]);
}

async function readOptions(path: string, read: ReadText, depth = 0): Promise<ResolvedOptions> {
  const empty: ResolvedOptions = { baseUrl: null, paths: null, pathsBase: directoryOf(path) };
  const text = await read(path);
  const config = text === null ? null : (parseJsonc(text) as ConfigFile | null);
  if (!config) return empty;
  const dir = directoryOf(path);
  const parentPath =
    typeof config.extends === 'string' && config.extends.startsWith('.') && depth < MAX_EXTENDS
      ? joinPath(dir, config.extends.endsWith('.json') ? config.extends : `${config.extends}.json`)
      : null;
  const inherited = parentPath ? await readOptions(parentPath, read, depth + 1) : empty;
  const options = config.compilerOptions ?? {};
  const baseUrl = typeof options.baseUrl === 'string' ? joinPath(dir, options.baseUrl) : null;
  const paths = stringPaths(options.paths);
  return {
    baseUrl: baseUrl ?? inherited.baseUrl,
    paths: paths ?? inherited.paths,
    pathsBase: paths ? (baseUrl ?? dir) : inherited.paths ? inherited.pathsBase : (baseUrl ?? dir),
  };
}

async function aliasScopes(paths: readonly string[], read: ReadText): Promise<AliasScope[]> {
  const scopes: AliasScope[] = [];
  for (const path of paths.filter((candidate) => TSCONFIG.test(candidate)).sort()) {
    const options = await readOptions(path, read);
    if (!options.baseUrl && !options.paths) continue;
    scopes.push({
      dir: directoryOf(path),
      baseUrl: options.baseUrl,
      pathsBase: options.pathsBase,
      paths: options.paths ?? [],
    });
  }
  return scopes;
}

function entryTargets(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || depth > 3) return [];
  const record = value as Record<string, unknown>;
  return ENTRY_CONDITIONS.flatMap((condition) => entryTargets(record[condition], depth + 1));
}

export function packageEntries(manifest: Record<string, unknown>): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  const exports = manifest.exports;
  if (typeof exports === 'string' || Array.isArray(exports)) {
    entries.set('.', entryTargets(Array.isArray(exports) ? exports[0] : exports));
  } else if (exports && typeof exports === 'object') {
    const record = exports as Record<string, unknown>;
    const keyed = Object.keys(record).some((key) => key.startsWith('.'));
    if (!keyed) entries.set('.', entryTargets(record));
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith('.')) entries.set(key, entryTargets(value));
    }
  }
  const main = ['source', 'module', 'main', 'types']
    .map((field) => manifest[field])
    .filter((value): value is string => typeof value === 'string');
  entries.set('.', [...(entries.get('.') ?? []), ...main]);
  return entries;
}

async function workspacePackages(
  paths: readonly string[],
  read: ReadText,
): Promise<PackageEntry[]> {
  const packages: PackageEntry[] = [];
  for (const path of paths.filter((candidate) => /(?:^|\/)package\.json$/.test(candidate)).sort()) {
    const text = await read(path);
    const manifest = text === null ? null : (parseJsonc(text) as Record<string, unknown> | null);
    if (!manifest || typeof manifest.name !== 'string') continue;
    packages.push({
      name: manifest.name,
      root: directoryOf(path),
      entries: packageEntries(manifest),
    });
  }
  return packages;
}

async function goModules(paths: readonly string[], read: ReadText): Promise<GoModule[]> {
  const modules: GoModule[] = [];
  for (const path of paths.filter((candidate) => /(?:^|\/)go\.mod$/.test(candidate)).sort()) {
    const text = await read(path);
    const module = text === null ? null : manifestName('go.mod', text);
    if (module) modules.push({ module, root: directoryOf(path) });
  }
  return modules;
}

function pythonRoots(paths: readonly string[]): string[] {
  const roots = new Set(['.', 'src']);
  for (const path of paths) {
    if (!PYTHON_MANIFEST.test(path)) continue;
    const dir = directoryOf(path);
    roots.add(dir);
    roots.add(dir === '.' ? 'src' : `${dir}/src`);
  }
  return [...roots].sort();
}

export async function readResolverConfig(
  paths: readonly string[],
  read: ReadText,
): Promise<ResolverConfig> {
  return {
    aliases: await aliasScopes(paths, read),
    packages: await workspacePackages(paths, read),
    goModules: await goModules(paths, read),
    pythonRoots: pythonRoots(paths),
  };
}
