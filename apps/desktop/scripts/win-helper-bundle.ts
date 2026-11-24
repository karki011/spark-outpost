import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { WIN_HELPER_EXE, winHelperEnv } from '../src/win-helper/protocol.ts';
import type { MacArch } from './builder-config.ts';

const run = promisify(execFile);
const MIN_DOTNET = 8;

function dotnet(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('dotnet', args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`dotnet ${args[0]} exited with ${code}.`)),
    );
  });
}

export function winHelperProject(repoRoot: string): string {
  return path.join(repoRoot, 'apps/desktop/native/win-helper');
}

export function winHelperBuiltDir(repoRoot: string, arch: MacArch): string {
  return path.join(repoRoot, '.local/win-helper', arch);
}

export function dotnetProblem(platform: NodeJS.Platform, version: string | null): string | null {
  if (platform !== 'win32')
    return 'The Windows helper builds only on Windows: Native AOT cannot cross-compile it from here.';
  if (version === null)
    return `The Windows helper needs the .NET ${MIN_DOTNET} SDK or newer, and dotnet was not found. Install it from https://dot.net.`;
  const major = Number.parseInt(version, 10);
  if (!Number.isFinite(major) || major < MIN_DOTNET)
    return `The Windows helper needs the .NET ${MIN_DOTNET} SDK or newer; dotnet ${version.trim()} is installed.`;
  return null;
}

async function dotnetVersion(): Promise<string | null> {
  return run('dotnet', ['--version']).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
}

async function requireDotnet(platform: NodeJS.Platform = process.platform): Promise<void> {
  const problem = dotnetProblem(platform, platform === 'win32' ? await dotnetVersion() : null);
  if (problem) throw new Error(problem);
}

export async function askWinHelper(binary: string, lines: object[]): Promise<unknown[]> {
  const child = spawn(binary, [], { env: winHelperEnv(process.env), windowsHide: true });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The Windows helper did not answer within 30 s.'));
    }, 30_000);
    child.once('error', reject);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  child.stdin.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  await done;
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

export async function checkWinHelperAnswers(binary: string): Promise<string> {
  const [status, hello] = (await askWinHelper(binary, [
    { id: 'status', op: 'status' },
    { id: 'hello', op: 'hello.available' },
  ])) as { id?: string; ok?: boolean; result?: { protocol?: number; available?: boolean } }[];
  if (status?.id !== 'status' || status.ok !== true || status.result?.protocol !== 1)
    throw new Error(`The Windows helper answered ${JSON.stringify(status)} to a status request.`);
  if (hello?.id !== 'hello' || hello.ok !== true || typeof hello.result?.available !== 'boolean')
    throw new Error(`The Windows helper answered ${JSON.stringify(hello)} to hello.available.`);
  return `protocol 1, Windows Hello ${hello.result.available ? 'available' : 'unavailable'}`;
}

export async function buildWinHelper(repoRoot: string, arch: MacArch): Promise<string> {
  await requireDotnet();
  if (arch !== 'x64') throw new Error('The Windows helper is built for x64 only for now.');
  const scratch = path.join(repoRoot, '.local/win-helper/build', arch);
  const built = winHelperBuiltDir(repoRoot, arch);
  console.log(`Building the Windows helper for ${arch}.`);
  await rm(scratch, { recursive: true, force: true });
  await dotnet([
    'publish',
    path.join(winHelperProject(repoRoot), 'src/SparkWinHelper.csproj'),
    '-c',
    'Release',
    '-r',
    `win-${arch}`,
    '-o',
    scratch,
    '--nologo',
  ]);
  await rm(built, { recursive: true, force: true });
  await mkdir(built, { recursive: true });
  await cp(path.join(scratch, WIN_HELPER_EXE), path.join(built, WIN_HELPER_EXE));
  if (arch === os.arch())
    console.log(
      `Windows helper check: ${await checkWinHelperAnswers(path.join(built, WIN_HELPER_EXE))}`,
    );
  return built;
}

export async function testWinHelper(repoRoot: string): Promise<void> {
  await requireDotnet();
  await dotnet([
    'test',
    path.join(winHelperProject(repoRoot), 'tests/SparkWinHelper.Tests.csproj'),
    '-c',
    'Release',
    '--nologo',
  ]);
}

export async function stageWinHelper(
  repoRoot: string,
  arch: MacArch,
  archDir: string,
): Promise<boolean> {
  const built = path.join(winHelperBuiltDir(repoRoot, arch), WIN_HELPER_EXE);
  const found = await stat(built).then(
    (info) => info.isFile(),
    () => false,
  );
  if (!found) {
    console.log(
      `Note: no Windows helper at ${built}, so this build has no Windows Hello. Run pnpm desktop:win-helper on Windows to include it.`,
    );
    return false;
  }
  const target = path.join(archDir, 'win-helper');
  await mkdir(target, { recursive: true });
  await cp(built, path.join(target, WIN_HELPER_EXE));
  return true;
}
