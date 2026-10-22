import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MacArch } from './builder-config.ts';
import { checkBundledBinary, clangArch, DEPLOYMENT_TARGET } from './bundled-binary.ts';
import { swiftEnv } from './mac-control-bundle.ts';

const run = promisify(execFile);

export const NO_ACTIVATE_ADDON = 'no-activate.node';
const SOURCE = 'no_activate.mm';

export function noActivateSource(repoRoot: string): string {
  return path.join(repoRoot, 'apps/desktop/no-activate', SOURCE);
}

export function noActivateBuiltDir(repoRoot: string, arch: MacArch): string {
  return path.join(repoRoot, '.local/no-activate', arch);
}

export function nodeApiHeaders(nodeExecPath: string): string {
  return path.resolve(path.dirname(nodeExecPath), '../include/node');
}

export function noActivateCheck(addon: string, arch: MacArch) {
  return checkBundledBinary({
    name: NO_ACTIVATE_ADDON,
    path: addon,
    arch,
    missing: 'Run pnpm desktop:no-activate to build it.',
  });
}

export function compileArgs(source: string, headers: string, arch: MacArch, out: string): string[] {
  return [
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-fobjc-arc',
    '-std=c++17',
    '-O2',
    '-arch',
    clangArch(arch),
    `-mmacosx-version-min=${DEPLOYMENT_TARGET}`,
    '-DNODE_GYP_MODULE_NAME=no_activate',
    '-I',
    headers,
    '-framework',
    'AppKit',
    source,
    '-o',
    out,
  ];
}

async function sourceStamp(source: string, headers: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(source));
  hash.update(await readFile(path.join(headers, 'node_api.h')));
  return hash.digest('hex');
}

async function isCurrent(built: string, arch: MacArch, stamp: string): Promise<boolean> {
  const saved = await readFile(path.join(built, 'stamp'), 'utf8').catch(() => null);
  if (saved !== stamp) return false;
  return noActivateCheck(path.join(built, NO_ACTIVATE_ADDON), arch).then(
    () => true,
    () => false,
  );
}

export async function buildNoActivate(repoRoot: string, arch: MacArch): Promise<string> {
  const built = noActivateBuiltDir(repoRoot, arch);
  const addon = path.join(built, NO_ACTIVATE_ADDON);
  const source = noActivateSource(repoRoot);
  const headers = nodeApiHeaders(process.execPath);
  const found = await stat(path.join(headers, 'node_api.h')).then(
    () => true,
    () => false,
  );
  if (!found) throw new Error(`No Node-API headers at ${headers}; install Node with its headers.`);
  const stamp = await sourceStamp(source, headers);
  if (!(await isCurrent(built, arch, stamp))) {
    console.log(`Building the no-activate addon for ${arch}.`);
    await rm(built, { recursive: true, force: true });
    await mkdir(built, { recursive: true });
    const env = swiftEnv(process.env);
    await run('xcrun', ['clang++', ...compileArgs(source, headers, arch, addon)], { env });
    await run('codesign', ['--force', '--sign', '-', addon]);
    await writeFile(path.join(built, 'stamp'), stamp);
  }
  await noActivateCheck(addon, arch);
  return built;
}

export async function stageNoActivate(
  builtDir: string,
  arch: MacArch,
  resources: string,
): Promise<void> {
  await noActivateCheck(path.join(builtDir, NO_ACTIVATE_ADDON), arch);
  const target = path.join(resources, 'no-activate');
  await mkdir(target, { recursive: true });
  await cp(path.join(builtDir, NO_ACTIVATE_ADDON), path.join(target, NO_ACTIVATE_ADDON));
}
