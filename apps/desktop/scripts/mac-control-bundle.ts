import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MacArch } from './builder-config.ts';
import { checkBundledBinary, clangArch, DEPLOYMENT_TARGET } from './bundled-binary.ts';

const run = promisify(execFile);
const BUFFER = 64 * 1024 * 1024;
const XCODE = '/Applications/Xcode.app/Contents/Developer';

export const MAC_CONTROL_BINARY = 'spark-mac-control';

export function macControlPackage(repoRoot: string): string {
  return path.join(repoRoot, 'apps/desktop/mac-control');
}

export function macControlBuiltDir(repoRoot: string, arch: MacArch): string {
  return path.join(repoRoot, '.local/mac-control', arch);
}

export function swiftEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const developer = env.DEVELOPER_DIR ?? (existsSync(XCODE) ? XCODE : undefined);
  return {
    ...env,
    MACOSX_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
    ...(developer ? { DEVELOPER_DIR: developer } : {}),
  };
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.swift'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}.build${path.sep}`))
    .sort();
}

export async function macControlStamp(packageDir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await sourceFiles(packageDir)) {
    hash.update(path.relative(packageDir, file));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

export function macControlCheck(binary: string, arch: MacArch) {
  return checkBundledBinary({
    name: MAC_CONTROL_BINARY,
    path: binary,
    arch,
    missing: 'Run pnpm desktop:mac-control to build it; Mac control needs it.',
  });
}

export async function checkMacControlAnswers(binary: string): Promise<void> {
  const child = execFile(binary, [], { env: {}, timeout: 10_000 });
  const answered = new Promise<string>((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('\n')) resolve(output);
    });
    child.once('error', reject);
    child.once('exit', () => resolve(output));
  });
  child.stdin?.end('{"id":"check","op":"status"}\n');
  const line = (await answered).split('\n')[0] ?? '';
  const parsed = JSON.parse(line) as { id?: string; ok?: boolean };
  if (parsed.id !== 'check' || parsed.ok !== true)
    throw new Error(`The Mac control helper answered "${line.slice(0, 200)}" to a status request.`);
}

async function isCurrent(built: string, arch: MacArch, stamp: string): Promise<boolean> {
  const saved = await readFile(path.join(built, 'stamp'), 'utf8').catch(() => null);
  if (saved !== stamp) return false;
  return macControlCheck(path.join(built, MAC_CONTROL_BINARY), arch).then(
    () => true,
    () => false,
  );
}

function swiftArgs(repoRoot: string, arch: MacArch): string[] {
  return [
    '-c',
    'release',
    '--arch',
    clangArch(arch),
    '--package-path',
    macControlPackage(repoRoot),
    '--scratch-path',
    path.join(repoRoot, '.local/mac-control/build', arch),
  ];
}

export async function buildMacControl(repoRoot: string, arch: MacArch): Promise<string> {
  const built = macControlBuiltDir(repoRoot, arch);
  const binary = path.join(built, MAC_CONTROL_BINARY);
  const stamp = await macControlStamp(macControlPackage(repoRoot));
  if (!(await isCurrent(built, arch, stamp))) {
    console.log(`Building the Mac control helper for ${arch}.`);
    const env = swiftEnv(process.env);
    const args = swiftArgs(repoRoot, arch);
    await run('swift', ['build', ...args], { env, maxBuffer: BUFFER });
    const { stdout } = await run('swift', ['build', ...args, '--show-bin-path'], { env });
    await rm(built, { recursive: true, force: true });
    await mkdir(built, { recursive: true });
    await cp(path.join(stdout.trim(), MAC_CONTROL_BINARY), binary);
    await run('codesign', ['--force', '--sign', '-', binary]);
    await writeFile(path.join(built, 'stamp'), stamp);
  }
  await macControlCheck(binary, arch);
  if (arch === os.arch()) await checkMacControlAnswers(binary);
  return built;
}

export async function testMacControl(repoRoot: string): Promise<void> {
  await run('swift', ['test', '--package-path', macControlPackage(repoRoot)], {
    env: swiftEnv(process.env),
    maxBuffer: BUFFER,
  });
}

export async function stageMacControl(
  builtDir: string,
  arch: MacArch,
  resources: string,
): Promise<void> {
  await macControlCheck(path.join(builtDir, MAC_CONTROL_BINARY), arch);
  const target = path.join(resources, 'mac-control/bin');
  await mkdir(target, { recursive: true });
  await cp(path.join(builtDir, MAC_CONTROL_BINARY), path.join(target, MAC_CONTROL_BINARY));
}
