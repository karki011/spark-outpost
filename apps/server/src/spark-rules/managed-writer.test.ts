import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rulesTextHash } from './accepted.ts';
import {
  ADMIN_SCRIPT,
  adminManagedWrite,
  adminScriptArgs,
  CANCELLED_PROMPT,
  CHANGED_MARK,
  CHANGED_STAGED,
  INSTALL_SCRIPT,
  installArgs,
  managedWriteFor,
  STALE_COMPANY,
  STALE_MARK,
  type StagedWrite,
} from './managed-writer.ts';
import { MANAGED_RULES_FILE, StaleRulesError } from './rules-store.ts';

const run = promisify(execFile);
const TARGET = "/Library/Application Support/Spark's Outpost/managed-settings.json";
const NEW_TEXT = '{"permissions":{"deny":["Push(force)"]}}\n';
const OLD_TEXT = '{"permissions":{}}\n';
const hashOf = (text: string) => rulesTextHash({ kind: 'text', text });
const UNPRIVILEGED_SCRIPT = INSTALL_SCRIPT.replace('/usr/sbin/chown root:wheel', '/usr/bin/true');

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'spark-managed-test-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function staged(previous: string | null, want = NEW_TEXT): Promise<StagedWrite> {
  const target = join(scratch, "Spark's Outpost", 'managed-settings.json');
  if (previous !== null) {
    await run('/bin/mkdir', ['-p', dirname(target)]);
    await writeFile(target, previous);
  }
  const source = join(scratch, 'source.json');
  await writeFile(source, NEW_TEXT);
  const previousHash = previous === null ? 'missing' : hashOf(previous);
  return { source, target, textHash: hashOf(want), previousHash };
}

async function install(write: StagedWrite): Promise<string> {
  try {
    await run('/bin/sh', ['-c', UNPRIVILEGED_SCRIPT, 'spark', ...installArgs(write)]);
    return 'installed';
  } catch (error) {
    return (error as { stderr?: string }).stderr?.trim() ?? 'failed';
  }
}

describe('the macOS admin prompt for the company file', () => {
  it('passes the install script and paths as arguments, never inside the AppleScript', () => {
    const args = adminScriptArgs({
      source: '/tmp/x/managed-settings.json',
      target: TARGET,
      textHash: 'a',
      previousHash: 'b',
    });
    const script = args.filter((_, index) => args[index - 1] === '-e').join('\n');
    expect(script).toBe(ADMIN_SCRIPT.join('\n'));
    expect(script).not.toContain("Spark's Outpost");
    expect(script).toContain('with administrator privileges');
    const rest = args.slice(ADMIN_SCRIPT.length * 2);
    expect(rest[0]).toBe(INSTALL_SCRIPT);
    expect(rest.slice(1, 3)).toEqual(['/tmp/x/managed-settings.json', TARGET]);
    expect(rest[3]).toMatch(
      /^\/Library\/Application Support\/Spark's Outpost\/\.managed-settings\./,
    );
    expect(rest.slice(4)).toEqual(["/Library/Application Support/Spark's Outpost", 'a', 'b']);
  });

  it('installs the staged text when both digests match', async () => {
    const write = await staged(OLD_TEXT);
    expect(await install(write)).toBe('installed');
    expect(await readFile(write.target, 'utf8')).toBe(NEW_TEXT);
  });

  it('creates the file when it was missing on the card', async () => {
    const write = await staged(null);
    expect(await install(write)).toBe('installed');
    expect(await readFile(write.target, 'utf8')).toBe(NEW_TEXT);
  });

  it('refuses staged text that is not what the card approved', async () => {
    const write = await staged(OLD_TEXT, '{"permissions":{"allow":["Push(force)"]}}\n');
    expect(await install(write)).toBe(CHANGED_MARK);
    expect(await readFile(write.target, 'utf8')).toBe(OLD_TEXT);
  });

  it('refuses when the company file changed after the card was shown', async () => {
    const write = await staged(OLD_TEXT);
    await writeFile(write.target, '{"permissions":{"ask":[]}}\n');
    expect(await install(write)).toBe(STALE_MARK);
    expect(await readFile(write.target, 'utf8')).toBe('{"permissions":{"ask":[]}}\n');
  });

  it('refuses when a file appeared where the card saw none', async () => {
    const write = await staged(null);
    await run('/bin/mkdir', ['-p', dirname(write.target)]);
    await writeFile(write.target, OLD_TEXT);
    expect(await install(write)).toBe(STALE_MARK);
  });

  it.runIf(process.platform === 'darwin')(
    'hands osascript the arguments intact, quotes and spaces included',
    async () => {
      const write = await staged(OLD_TEXT);
      const lines = ADMIN_SCRIPT.map((line) =>
        line.replace(/ with prompt ".*" with administrator privileges/, ''),
      );
      const args = adminScriptArgs(write).slice(ADMIN_SCRIPT.length * 2);
      args[0] = UNPRIVILEGED_SCRIPT;
      await run('/usr/bin/osascript', [...lines.flatMap((line) => ['-e', line]), ...args]);
      expect(await readFile(write.target, 'utf8')).toBe(NEW_TEXT);
    },
  );

  it.runIf(process.platform === 'darwin')(
    'stages the new text privately and hands its digest to the prompt',
    async () => {
      let seen: { text: string; mode: number; folderMode: number; want: string } | null = null;
      const write = adminManagedWrite(async (args) => {
        const rest = args.slice(ADMIN_SCRIPT.length * 2);
        const source = rest[1]!;
        seen = {
          text: await readFile(source, 'utf8'),
          mode: (await stat(source)).mode & 0o777,
          folderMode: (await stat(dirname(source))).mode & 0o777,
          want: rest[5]!,
        };
      });
      await write(TARGET, NEW_TEXT, 'missing');
      expect(seen).toEqual({
        text: NEW_TEXT,
        mode: 0o600,
        folderMode: 0o700,
        want: hashOf(NEW_TEXT),
      });
    },
  );

  it.runIf(process.platform === 'darwin')('names what stopped the write', async () => {
    const failing = (message: string) =>
      adminManagedWrite(() => Promise.reject(new Error(message)));
    await expect(
      failing('execution error: User canceled. (-128)')(TARGET, '{}', 'missing'),
    ).rejects.toThrow(CANCELLED_PROMPT);
    const stale = failing(`execution error: ${STALE_MARK} (3)`)(TARGET, '{}', 'missing');
    await expect(stale).rejects.toThrow(StaleRulesError);
    await expect(failing(`x ${STALE_MARK}`)(TARGET, '{}', 'missing')).rejects.toThrow(
      STALE_COMPANY,
    );
    await expect(failing(`x ${CHANGED_MARK}`)(TARGET, '{}', 'missing')).rejects.toThrow(
      CHANGED_STAGED,
    );
  });

  it('uses the admin prompt only for the real company file', () => {
    expect(managedWriteFor('/tmp/elsewhere.json').name).toBe('plainWrite');
    expect(managedWriteFor(MANAGED_RULES_FILE).name).not.toBe('plainWrite');
  });
});
