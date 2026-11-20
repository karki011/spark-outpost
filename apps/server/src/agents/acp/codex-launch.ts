import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand, type RunCommand } from '../../setup/command.ts';
import { atLeast, cliVersion } from './cli-version.ts';
import { CODEX_READ_ONLY_MODE, codexPermissionProfiles } from './codex-permissions.ts';

export const CODEX_PROFILES_FROM = '0.149.1';
const STARTUP_PROFILE = ':read-only';

export const CODEX_PLAIN_SANDBOX_NOTE =
  "This Codex can't use Spark's secret-file protection, so it ran with Codex's own sandbox instead";

const CONFIG_FAILURE =
  /failed to load (?:workspace requirements|configuration)|default_permissions/i;

export function supportsPermissionProfiles(version: string | null): boolean {
  return version === null || atLeast(version, CODEX_PROFILES_FROM);
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

export function tomlInline(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlInline).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(
      ([key, entry]) => `${JSON.stringify(key)} = ${tomlInline(entry)}`,
    );
    return `{ ${entries.join(', ')} }`;
  }
  throw new Error('A Codex override holds a value TOML cannot express.');
}

export function startupOverrides(profiles: boolean): string[] {
  if (!profiles) return [`default_permissions=${tomlInline(STARTUP_PROFILE)}`];
  return [
    `permissions=${tomlInline(codexPermissionProfiles())}`,
    `default_permissions=${tomlInline(CODEX_READ_ONLY_MODE)}`,
  ];
}

async function startupWrapper(codexPath: string, dir: string, profiles: boolean): Promise<string> {
  const wrapper = join(dir, 'codex-spark');
  const flags = startupOverrides(profiles)
    .map((override) => `-c ${shellQuote(override)}`)
    .join(' ');
  await writeFile(wrapper, `#!/bin/sh\nexec ${shellQuote(codexPath)} ${flags} "$@"\n`);
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
  const version = await cliVersion(path, run);
  const capable = supportsPermissionProfiles(version);
  const profiles = capable && !legacy;
  const wrapped =
    capable && process.platform !== 'win32'
      ? { CODEX_PATH: await startupWrapper(path, dir, profiles) }
      : {};
  return { cli: { ...cli, ...wrapped }, profiles, version };
}
