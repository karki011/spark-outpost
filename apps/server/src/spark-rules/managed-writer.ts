import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { RulesFileError } from './rules-file.ts';
import { rulesTextHash } from './accepted.ts';
import {
  MANAGED_RULES_FILE,
  readRulesFile,
  StaleRulesError,
  type ManagedWrite,
} from './rules-store.ts';

const run = promisify(execFile);

export const STALE_MARK = 'SPARK_RULES_STALE';
export const CHANGED_MARK = 'SPARK_RULES_STAGED_CHANGED';

export const INSTALL_SCRIPT = [
  'set -eu',
  'source=$1 target=$2 staged=$3 folder=$4 want=$5 was=$6',
  'digest() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -d " " -f 1; }',
  '/bin/mkdir -p "$folder"',
  'if [ "$was" = missing ]; then',
  `  if [ -e "$target" ]; then echo ${STALE_MARK} >&2; exit 3; fi`,
  `elif [ ! -f "$target" ] || [ "$(digest "$target")" != "$was" ]; then echo ${STALE_MARK} >&2; exit 3; fi`,
  '/bin/cp "$source" "$staged"',
  '/usr/sbin/chown root:wheel "$staged"',
  '/bin/chmod 644 "$staged"',
  `if [ "$(digest "$staged")" != "$want" ]; then /bin/rm -f "$staged"; echo ${CHANGED_MARK} >&2; exit 4; fi`,
  '/bin/mv -f "$staged" "$target"',
].join('\n');

export const ADMIN_SCRIPT = [
  'on run argv',
  'set cmd to "/bin/sh -c " & quoted form of (item 1 of argv) & " spark"',
  'repeat with i from 2 to count of argv',
  'set cmd to cmd & " " & quoted form of (item i of argv)',
  'end repeat',
  'do shell script cmd with prompt "Spark Outpost wants to change your company’s Spark rules." with administrator privileges',
  'end run',
];

export const CANCELLED_PROMPT =
  'You cancelled the macOS password prompt, so the company rules did not change.';
export const STALE_COMPANY =
  'managed-settings.json changed after the card was shown, so Spark changed nothing.';
export const CHANGED_STAGED =
  'The staged company rules changed before macOS wrote them, so Spark changed nothing.';

export type ScriptRunner = (args: readonly string[]) => Promise<void>;

export interface StagedWrite {
  source: string;
  target: string;
  textHash: string;
  previousHash: string;
}

export function installArgs(write: StagedWrite): string[] {
  const folder = dirname(write.target);
  const staged = join(folder, `.managed-settings.${randomUUID()}.tmp`);
  return [write.source, write.target, staged, folder, write.textHash, write.previousHash];
}

export function adminScriptArgs(write: StagedWrite): string[] {
  const lines = ADMIN_SCRIPT.flatMap((line) => ['-e', line]);
  return [...lines, INSTALL_SCRIPT, ...installArgs(write)];
}

const osascript: ScriptRunner = async (args) => {
  await run('/usr/bin/osascript', [...args], { timeout: 10 * 60_000 });
};

function scriptError(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('-128') || /user canceled/i.test(text)) {
    return new RulesFileError(CANCELLED_PROMPT);
  }
  if (text.includes(STALE_MARK)) return new StaleRulesError(STALE_COMPANY);
  if (text.includes(CHANGED_MARK)) return new RulesFileError(CHANGED_STAGED);
  return error instanceof Error ? error : new Error(text);
}

export function adminManagedWrite(runner: ScriptRunner = osascript): ManagedWrite {
  return async (target, text, previousHash) => {
    if (process.platform !== 'darwin') {
      throw new RulesFileError('Company rules can only be changed on a Mac.');
    }
    const folder = await mkdtemp(join(tmpdir(), 'spark-managed-'));
    const source = join(folder, 'managed-settings.json');
    const textHash = rulesTextHash({ kind: 'text', text });
    try {
      await writeFile(source, text, { mode: 0o600 });
      await runner(adminScriptArgs({ source, target, textHash, previousHash }));
    } catch (error) {
      throw scriptError(error);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}

async function plainWrite(target: string, text: string, previousHash: string): Promise<void> {
  if (rulesTextHash(await readRulesFile(target)) !== previousHash) {
    throw new StaleRulesError(STALE_COMPANY);
  }
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.managed-settings.${randomUUID()}.tmp`);
  await writeFile(temp, text, { mode: 0o644 });
  await rename(temp, target);
}

export function managedWriteFor(target: string): ManagedWrite {
  return target === MANAGED_RULES_FILE ? adminManagedWrite() : plainWrite;
}
