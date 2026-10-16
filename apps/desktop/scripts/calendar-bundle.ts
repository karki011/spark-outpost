import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MacArch } from './builder-config.ts';
import { checkBundledBinary, clangArch } from './bundled-binary.ts';
import { swiftEnv } from './mac-control-bundle.ts';

const run = promisify(execFile);
const BUFFER = 64 * 1024 * 1024;

export const CALENDAR_BINARY = 'spark-calendar';
export const CALENDAR_SEED_BINARY = 'spark-calendar-seed';

export function calendarPackage(repoRoot: string): string {
  return path.join(repoRoot, 'apps/desktop/calendar');
}

export function calendarBuiltDir(repoRoot: string, arch: MacArch): string {
  return path.join(repoRoot, '.local/calendar', arch);
}

function scratchPath(repoRoot: string, name: string): string {
  return path.join(repoRoot, '.local/calendar/build', name);
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.swift'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}.build${path.sep}`))
    .sort();
}

export async function calendarStamp(packageDir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await sourceFiles(packageDir)) {
    hash.update(path.relative(packageDir, file));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

export function calendarCheck(binary: string, arch: MacArch) {
  return checkBundledBinary({
    name: CALENDAR_BINARY,
    path: binary,
    arch,
    missing: 'Run pnpm desktop:calendar to build it; Calendar needs it.',
  });
}

export async function stagedCalendarProblems(stagedDir: string): Promise<string[]> {
  const entries = await readdir(stagedDir, { recursive: true }).catch(() => [] as string[]);
  const files = entries.map((entry) => entry.split(path.sep).join('/'));
  const problems: string[] = [];
  if (!files.includes(`bin/${CALENDAR_BINARY}`)) problems.push(`bin/${CALENDAR_BINARY} is missing`);
  if (files.some((file) => path.basename(file) === CALENDAR_SEED_BINARY))
    problems.push(`${CALENDAR_SEED_BINARY} is a development tool and must not ship`);
  return problems;
}

export async function checkStagedCalendar(stagedDir: string, arch: MacArch): Promise<void> {
  const problems = await stagedCalendarProblems(stagedDir);
  if (problems.length > 0)
    throw new Error(`The staged Calendar helper can't be bundled: ${problems.join('; ')}.`);
  await calendarCheck(path.join(stagedDir, 'bin', CALENDAR_BINARY), arch);
}

export async function checkCalendarAnswers(binary: string): Promise<void> {
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
    throw new Error(`The Calendar helper answered "${line.slice(0, 200)}" to a status request.`);
}

async function isCurrent(built: string, arch: MacArch, stamp: string): Promise<boolean> {
  const saved = await readFile(path.join(built, 'stamp'), 'utf8').catch(() => null);
  if (saved !== stamp) return false;
  return calendarCheck(path.join(built, CALENDAR_BINARY), arch).then(
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
    calendarPackage(repoRoot),
    '--scratch-path',
    scratchPath(repoRoot, arch),
  ];
}

export async function buildCalendar(repoRoot: string, arch: MacArch): Promise<string> {
  const built = calendarBuiltDir(repoRoot, arch);
  const binary = path.join(built, CALENDAR_BINARY);
  const stamp = await calendarStamp(calendarPackage(repoRoot));
  if (!(await isCurrent(built, arch, stamp))) {
    console.log(`Building the Calendar helper for ${arch}.`);
    const env = swiftEnv(process.env);
    const args = swiftArgs(repoRoot, arch);
    await run('swift', ['build', ...args], { env, maxBuffer: BUFFER });
    const { stdout } = await run('swift', ['build', ...args, '--show-bin-path'], { env });
    await rm(built, { recursive: true, force: true });
    await mkdir(built, { recursive: true });
    for (const name of [CALENDAR_BINARY, CALENDAR_SEED_BINARY]) {
      const target = path.join(built, name);
      await cp(path.join(stdout.trim(), name), target);
      await run('codesign', ['--force', '--sign', '-', target]);
    }
    await writeFile(path.join(built, 'stamp'), stamp);
  }
  await calendarCheck(binary, arch);
  if (arch === os.arch()) await checkCalendarAnswers(binary);
  return built;
}

export async function testCalendar(repoRoot: string): Promise<void> {
  const args = ['--package-path', calendarPackage(repoRoot), '--scratch-path'];
  await run('swift', ['test', ...args, scratchPath(repoRoot, 'test')], {
    env: swiftEnv(process.env),
    maxBuffer: BUFFER,
  });
}

export async function stageCalendar(
  builtDir: string,
  arch: MacArch,
  resources: string,
): Promise<void> {
  await calendarCheck(path.join(builtDir, CALENDAR_BINARY), arch);
  const target = path.join(resources, 'calendar/bin');
  await mkdir(target, { recursive: true });
  await cp(path.join(builtDir, CALENDAR_BINARY), path.join(target, CALENDAR_BINARY));
}
