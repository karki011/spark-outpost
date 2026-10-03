import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand, type RunCommand } from '../../setup/command.ts';

export const CODEX_PROFILES_FROM = '0.149.1';
const STARTUP_PROFILE = ':read-only';

export const CODEX_PLAIN_SANDBOX_NOTE =
  "This Codex can't use Spark's secret-file protection, so it ran with Codex's own sandbox instead";

const VERSION_TIMEOUT_MS = 10_000;
const CONFIG_FAILURE =
  /failed to load (?:workspace requirements|configuration)|default_permissions/i;
const versions = new Map<string, Promise<string | null>>();

function parts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

export function atLeast(version: string, minimum: string): boolean {
  const have = parts(version);
  const need = parts(minimum);
  for (let index = 0; index < need.length; index += 1) {
    const difference = (have[index] ?? 0) - (need[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function supportsPermissionProfiles(version: string | null): boolean {
  return version === null || atLeast(version, CODEX_PROFILES_FROM);
}

export function codexVersion(path: string, run: RunCommand = runCommand): Promise<string | null> {
  const known = versions.get(path);
  if (known) return known;
  const found = run(path, ['--version'], VERSION_TIMEOUT_MS).then(
    (result) => (result.code === 0 ? (result.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null) : null),
    () => null,
  );
  versions.set(path, found);
  return found;
}

export function isCodexConfigFailure(message: string): boolean {
  return CONFIG_FAILURE.test(message);
}

export function codexConfigFailed(cause: unknown, stderrTail: string): boolean {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return isCodexConfigFailure(`${detail}\n${stderrTail}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function startupWrapper(codexPath: string, dir: string): Promise<string> {
  const wrapper = join(dir, 'codex-spark');
  const override = `default_permissions=${JSON.stringify(STARTUP_PROFILE)}`;
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec ${shellQuote(codexPath)} -c ${shellQuote(override)} "$@"\n`,
  );
  await chmod(wrapper, 0o755);
  return wrapper;
}

export interface CodexLaunch {
  cli: Record<string, string>;
  profiles: boolean;
  version: string | null;
}

export async function prepareCodexLaunch(
  cli: Record<string, string>,
  dir: string,
  legacy: boolean,
  run: RunCommand = runCommand,
): Promise<CodexLaunch> {
  const path = cli.CODEX_PATH;
  if (!path) return { cli, profiles: !legacy, version: null };
  const version = await codexVersion(path, run);
  const capable = supportsPermissionProfiles(version);
  const wrapped =
    capable && process.platform !== 'win32' ? { CODEX_PATH: await startupWrapper(path, dir) } : {};
  return { cli: { ...cli, ...wrapped }, profiles: capable && !legacy, version };
}
