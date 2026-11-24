import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isRecord } from '../agent-config/records.ts';
import type { Db } from '../persistence/db.ts';
import { setModHealth } from '../persistence/native-terminal-mod-reports.ts';
import type { LiveSession } from './native-runtime-types.ts';
import { cliRun, verbatimOption } from './windows-cli.ts';

export const MOD_STARTUP_MS = 15_000;
const MANAGED_DIR = '/Library/Application Support/ClaudeCode';
const VALIDATE_MS = 20_000;
const exec = promisify(execFile);

const BLOCKS: [string, string][] = [
  ['disableAllHooks', 'your organization turned hooks off for Claude Code'],
  ['allowManagedHooksOnly', 'your organization allows only its own hooks in Claude Code'],
  ['allowManagedModsOnly', 'your organization allows only its own mods in Claude Code'],
];
const DID_NOT_CHECK_IN = `it didn’t check in within ${MOD_STARTUP_MS / 1000} seconds of the session starting`;
const REJECTED = 'Claude Code’s plugin check rejected it';

export function managedBlock(settings: readonly unknown[]): string | null {
  for (const [key, reason] of BLOCKS)
    if (settings.some((entry) => isRecord(entry) && entry[key] === true)) return reason;
  return null;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function readManagedSettings(directory = MANAGED_DIR): Promise<unknown[]> {
  const dropIns = join(directory, 'managed-settings.d');
  const names = await readdir(dropIns).catch(() => [] as string[]);
  return Promise.all([
    readJson(join(directory, 'managed-settings.json')),
    ...names.filter((name) => name.endsWith('.json')).map((name) => readJson(join(dropIns, name))),
  ]);
}

export async function pluginCheckFails(command: string, directory: string): Promise<boolean> {
  try {
    const run = cliRun(command, ['plugin', 'validate', directory]);
    const { stdout, stderr } = await exec(run.file, run.args, {
      timeout: VALIDATE_MS,
      maxBuffer: 1_000_000,
      ...verbatimOption(run),
    });
    return !`${stdout}${stderr}`.includes('Validation passed');
  } catch (error) {
    return isRecord(error) && error.killed !== true;
  }
}

export function modExpected(session: LiveSession): boolean {
  return session.row.provider === 'claude' && session.launch.args.includes('--plugin-dir');
}

export interface ModHealthDeps {
  db: Db;
  managed?: () => Promise<unknown[]>;
  checkFails?: (command: string, directory: string) => Promise<boolean>;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export function modHealth(deps: ModHealthDeps) {
  const managed = deps.managed ?? (() => readManagedSettings());
  const checkFails = deps.checkFails ?? pluginCheckFails;
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms).unref());
  const clearTimer =
    deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const windows = new Map<string, unknown>();
  const loaded = new Set<string>();
  const keyOf = (session: LiveSession) => `${session.row.id}:${session.row.generation}`;
  const close = (conversationId: string) => {
    const timer = windows.get(conversationId);
    if (timer !== undefined) clearTimer(timer);
    windows.delete(conversationId);
  };
  const missing = (session: LiveSession, reason: string) =>
    setModHealth(deps.db, session.row, 'missing', reason).catch(() => false);
  const reasonFor = async (session: LiveSession): Promise<string> => {
    const blocked = managedBlock(await managed());
    if (blocked) return blocked;
    const directory = session.launch.args[session.launch.args.indexOf('--plugin-dir') + 1];
    if (directory && (await checkFails(session.launch.command, directory))) return REJECTED;
    return DID_NOT_CHECK_IN;
  };
  const expire = async (session: LiveSession) => {
    windows.delete(session.row.conversation_id);
    if (loaded.has(keyOf(session))) return;
    const reason = await reasonFor(session);
    if (!loaded.has(keyOf(session))) await missing(session, reason);
  };

  return {
    async launched(session: LiveSession): Promise<void> {
      if (!modExpected(session)) return;
      const blocked = managedBlock(await managed());
      if (blocked && !loaded.has(keyOf(session))) await missing(session, blocked);
    },

    ready(session: LiveSession): void {
      const conversationId = session.row.conversation_id;
      if (!modExpected(session) || loaded.has(keyOf(session)) || windows.has(conversationId))
        return;
      windows.set(
        conversationId,
        setTimer(() => void expire(session), MOD_STARTUP_MS),
      );
    },

    checkedIn(session: LiveSession): void {
      close(session.row.conversation_id);
      const key = keyOf(session);
      if (loaded.has(key)) return;
      loaded.add(key);
      void setModHealth(deps.db, session.row, 'loaded', null).catch(() => loaded.delete(key));
    },

    ended(conversationId: string): void {
      close(conversationId);
    },

    dispose(): void {
      for (const conversationId of [...windows.keys()]) close(conversationId);
    },
  };
}
