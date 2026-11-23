import { execFile } from 'node:child_process';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BuildPlatform, MacArch } from './builder-config.ts';

const run = promisify(execFile);

export const POSTGRES_BINARIES = ['initdb', 'postgres'];
const WINDOWS_POSTGRES_BINARIES = ['initdb.exe', 'postgres.exe', 'pg_ctl.exe'];

const KEPT_EXTENSION = /^(plpgsql|dict_snowball|.+_and_.+)\.dylib$/;
const KEPT_EXTENSION_FILES = /^plpgsql[.-]/;
const UNUSED_DIRS = ['include', 'lib/pkgconfig', 'lib/postgresql/pgxs', 'share/doc', 'share/man'];

export function keepsServerModule(name: string): boolean {
  return KEPT_EXTENSION.test(name);
}

export function keepsExtensionFile(name: string): boolean {
  return KEPT_EXTENSION_FILES.test(name);
}

export function loaderPathLinks(file: string, otoolOutput: string): string[] {
  const linked = otoolOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0] ?? '')
    .filter((name) => name.startsWith('@'));
  return linked.map((name) => {
    if (!name.startsWith('@loader_path/')) {
      throw new Error(`Can't resolve ${name} linked from ${file}; only @loader_path is supported.`);
    }
    return path.posix.resolve(path.posix.dirname(file), name.slice('@loader_path/'.length));
  });
}

export async function linkedClosure(
  roots: string[],
  linksOf: (file: string) => Promise<string[]>,
): Promise<Set<string>> {
  const seen = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    pending.push(...(await linksOf(file)));
  }
  return seen;
}

async function linksWithTargets(file: string): Promise<string[]> {
  const { stdout } = await run('otool', ['-L', file]);
  const links = loaderPathLinks(file, stdout);
  const isLink = (await lstat(file)).isSymbolicLink();
  return isLink ? [...links, await realpath(file)] : links;
}

async function removeUnlisted(dir: string, keep: (name: string) => boolean): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() || keep(entry.name)) continue;
    await rm(path.join(dir, entry.name), { force: true });
  }
}

export function postgresNativeDir(
  runtimeDir: string,
  arch: MacArch,
  platform: BuildPlatform = 'mac',
): string {
  const os = platform === 'win' ? 'windows' : 'darwin';
  return path.join(runtimeDir, `node_modules/@embedded-postgres/${os}-${arch}/native`);
}

async function removeUnusedDirs(nativeDir: string): Promise<void> {
  for (const dir of UNUSED_DIRS)
    await rm(path.join(nativeDir, dir), { recursive: true, force: true });
}

export async function prunePostgresWindows(nativeDir: string): Promise<void> {
  await removeUnusedDirs(nativeDir);
}

export async function prunePostgres(nativeDir: string): Promise<void> {
  await removeUnusedDirs(nativeDir);
  await removeUnlisted(path.join(nativeDir, 'bin'), (name) => POSTGRES_BINARIES.includes(name));
  const modulesDir = path.join(nativeDir, 'lib/postgresql');
  await removeUnlisted(modulesDir, keepsServerModule);
  await removeUnlisted(path.join(nativeDir, 'share/postgresql/extension'), keepsExtensionFile);
  const roots = [
    ...POSTGRES_BINARIES.map((name) => path.join(nativeDir, 'bin', name)),
    ...(await readdir(modulesDir)).map((name) => path.join(modulesDir, name)),
  ];
  const needed = await linkedClosure(roots, linksWithTargets);
  const libDir = path.join(nativeDir, 'lib');
  const realLibDir = await realpath(libDir);
  await removeUnlisted(
    libDir,
    (name) => needed.has(path.join(libDir, name)) || needed.has(path.join(realLibDir, name)),
  );
}

export async function checkPostgresStarts(
  nativeDir: string,
  platform: BuildPlatform = 'mac',
): Promise<void> {
  const binaries = platform === 'win' ? WINDOWS_POSTGRES_BINARIES : POSTGRES_BINARIES;
  for (const name of binaries) {
    await run(path.join(nativeDir, 'bin', name), ['--version']);
  }
}
