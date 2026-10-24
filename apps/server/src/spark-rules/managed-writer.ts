import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { RulesFileError } from './rules-file.ts';
import { MANAGED_RULES_FILE, type ManagedWrite } from './rules-store.ts';

const run = promisify(execFile);

export const ADMIN_SCRIPT = [
  'on run argv',
  'set source to item 1 of argv',
  'set target to item 2 of argv',
  'set staged to item 3 of argv',
  'set folder to item 4 of argv',
  'do shell script "/bin/mkdir -p " & quoted form of folder & " && /bin/cp " & quoted form of source & " " & quoted form of staged & " && /usr/sbin/chown root:wheel " & quoted form of staged & " && /bin/chmod 644 " & quoted form of staged & " && /bin/mv -f " & quoted form of staged & " " & quoted form of target with prompt "Spark Outpost wants to change your company’s Spark rules." with administrator privileges',
  'end run',
];

export const CANCELLED_PROMPT =
  'You cancelled the macOS password prompt, so the company rules did not change.';

export type ScriptRunner = (args: readonly string[]) => Promise<void>;

export function adminScriptArgs(source: string, target: string): string[] {
  const staged = join(dirname(target), `.managed-settings.${randomUUID()}.tmp`);
  const lines = ADMIN_SCRIPT.flatMap((line) => ['-e', line]);
  return [...lines, source, target, staged, dirname(target)];
}

const osascript: ScriptRunner = async (args) => {
  await run('/usr/bin/osascript', [...args], { timeout: 10 * 60_000 });
};

function cancelled(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('-128') || /user canceled/i.test(text);
}

export function adminManagedWrite(runner: ScriptRunner = osascript): ManagedWrite {
  return async (target, text) => {
    if (process.platform !== 'darwin') {
      throw new RulesFileError('Company rules can only be changed on a Mac.');
    }
    const folder = await mkdtemp(join(tmpdir(), 'spark-managed-'));
    const source = join(folder, 'managed-settings.json');
    try {
      await writeFile(source, text, { mode: 0o644 });
      await runner(adminScriptArgs(source, target));
    } catch (error) {
      if (cancelled(error)) throw new RulesFileError(CANCELLED_PROMPT);
      throw error;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}

async function plainWrite(target: string, text: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.managed-settings.${randomUUID()}.tmp`);
  await writeFile(temp, text, { mode: 0o644 });
  await rename(temp, target);
}

export function managedWriteFor(target: string): ManagedWrite {
  return target === MANAGED_RULES_FILE ? adminManagedWrite() : plainWrite;
}
