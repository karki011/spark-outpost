import { readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { isRecord } from '../records.ts';

export interface InstalledPlugin {
  key: string;
  name: string;
  marketplace: string;
  version: string | null;
  gitCommitSha: string | null;
  lastUpdated: string | null;
  root: string | null;
  rejected: string | null;
}

const MAX_INSTALLED_BYTES = 1024 * 1024;
const OUTSIDE_CACHE =
  "Its install folder is outside Claude's plugin cache, so Spark won't load it.";
const MISSING = 'Its install folder is missing. Reinstall it with claude plugin install.';

function splitKey(key: string): { name: string; marketplace: string } {
  const at = key.lastIndexOf('@');
  return at > 0
    ? { name: key.slice(0, at), marketplace: key.slice(at + 1) }
    : { name: key, marketplace: '' };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

async function resolveRoot(
  cache: string | null,
  installPath: unknown,
): Promise<Pick<InstalledPlugin, 'root' | 'rejected'>> {
  if (typeof installPath !== 'string' || installPath === '')
    return { root: null, rejected: MISSING };
  const real = await realOrNull(installPath);
  if (!real) return { root: null, rejected: MISSING };
  if (!cache || !isInside(cache, real)) return { root: null, rejected: OUTSIDE_CACHE };
  return { root: real, rejected: null };
}

async function readInstalledJson(configDir: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8');
    if (text.length > MAX_INSTALLED_BYTES) return {};
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && isRecord(parsed.plugins) ? parsed.plugins : {};
  } catch {
    return {};
  }
}

export async function installedPlugins(configDir: string): Promise<InstalledPlugin[]> {
  const plugins = await readInstalledJson(configDir);
  const cache = await realOrNull(join(configDir, 'plugins', 'cache'));
  const found: InstalledPlugin[] = [];
  for (const [key, installs] of Object.entries(plugins)) {
    if (!Array.isArray(installs)) continue;
    const install = installs.find((entry) => isRecord(entry) && entry.scope === 'user');
    if (!isRecord(install)) continue;
    found.push({
      key,
      ...splitKey(key),
      version: stringOrNull(install.version),
      gitCommitSha: stringOrNull(install.gitCommitSha),
      lastUpdated: stringOrNull(install.lastUpdated),
      ...(await resolveRoot(cache, install.installPath)),
    });
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}
