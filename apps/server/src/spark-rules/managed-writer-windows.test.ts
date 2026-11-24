import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rulesTextHash } from './accepted.ts';
import {
  CANCELLED_UAC,
  CHANGED_STAGED_WINDOWS,
  elevationArgs,
  NOT_WRITTEN_WINDOWS,
  SCRIPT_CHANGED_WINDOWS,
  windowsInstallScript,
  powershellLiteral,
  systemPowershell,
  windowsManagedWrite,
  type ElevatedRunner,
} from './managed-writer-windows.ts';
import { StaleRulesError } from './rules-store.ts';

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const TARGET = 'C:\\ProgramData\\Spark’s Outpost\\managed-settings.json';
const NEW_TEXT = '{"permissions":{"deny":["Push(force)"]}}\n';
const hashOf = (text: string) => rulesTextHash({ kind: 'text', text });

const decode = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf16le');

function outerOf(args: readonly string[]): string {
  expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  expect(args).toHaveLength(4);
  return decode(args[3]!);
}

function innerOf(outer: string): string {
  const match = /-EncodedCommand ([A-Za-z0-9+/=]+)'/.exec(outer);
  expect(match).not.toBeNull();
  return decode(match![1]!);
}

function valueOf(inner: string, name: string): string {
  const line = inner.split('\n').find((entry) => entry.startsWith(`$${name} = `));
  const literal = line!.slice(`$${name} = `.length);
  expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true);
  return literal.slice(1, -1).replace(/(['\u2018\u2019\u201A\u201B])\1/g, '$1');
}

function scriptPathOf(bootstrap: string): string {
  const match = /ReadAllBytes\('((?:[^']|'')*)'\)/.exec(bootstrap);
  expect(match).not.toBeNull();
  return match![1]!.replace(/''/g, "'");
}

async function installScriptOf(args: readonly string[]): Promise<string> {
  const bootstrap = innerOf(outerOf(args));
  const script = await readFile(scriptPathOf(bootstrap), 'utf8');
  const sha = createHash('sha256').update(script).digest('hex');
  expect(bootstrap).toContain(`if ($hex -ne '${sha}') { exit 6 }`);
  return script;
}

const LONG_PATH =
  "C:\\Users\\Ada O'Lovelace-Byron the Countess\\AppData\\Local\\Temp\\spark-managed-AbCdEf\\install.ps1";

const install = {
  source: 'C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp\\spark-managed-x\\managed-settings.json',
  target: TARGET,
  staged: 'C:\\ProgramData\\Spark’s Outpost\\.managed-settings.1.tmp',
  textHash: 'abc',
  previousHash: 'missing',
};

describe('the Windows elevation command for the company file', () => {
  it('runs PowerShell from System32', () => {
    expect(systemPowershell({ SystemRoot: 'D:\\Win' })).toBe(
      'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(systemPowershell({})).toBe(POWERSHELL);
  });

  it('doubles straight and curly single quotes in literals', () => {
    expect(powershellLiteral("C:\\Spark's ‘x’ ‚y‛")).toBe("'C:\\Spark''s ‘‘x’’ ‚‚y‛‛'");
    expect(powershellLiteral('C:\\Program Files\\a b')).toBe("'C:\\Program Files\\a b'");
  });

  it('asks UAC for an elevated, hidden PowerShell and waits for its exit code', () => {
    const outer = outerOf(elevationArgs(POWERSHELL, LONG_PATH, 'f'.repeat(64)));
    expect(outer).toContain(`Start-Process -FilePath '${POWERSHELL}' -Verb RunAs -Wait -PassThru`);
    expect(outer).toContain('-WindowStyle Hidden');
    expect(outer).toContain('NativeErrorCode -eq 1223) { exit 1223 }');
    expect(outer).toContain('exit $process.ExitCode');
  });

  it('hands ShellExecute a short bootstrap that runs the script only if its digest matches', () => {
    const outer = outerOf(elevationArgs(POWERSHELL, LONG_PATH, 'f'.repeat(64)));
    const argumentList = /-ArgumentList '([^']*)'/.exec(outer)![1]!;
    expect(argumentList.length).toBeLessThan(2000);
    const bootstrap = innerOf(outer);
    expect(scriptPathOf(bootstrap)).toBe(LONG_PATH);
    expect(bootstrap).toContain(`if ($hex -ne '${'f'.repeat(64)}') { exit 6 }`);
    expect(bootstrap.indexOf('exit 6')).toBeLessThan(bootstrap.indexOf('[scriptblock]::Create'));
  });

  it('carries every path intact, spaces and quotes included', () => {
    const inner = windowsInstallScript(install);
    expect(valueOf(inner, 'source')).toBe(install.source);
    expect(valueOf(inner, 'target')).toBe(TARGET);
    expect(valueOf(inner, 'staged')).toBe(install.staged);
    expect(valueOf(inner, 'folder')).toBe('C:\\ProgramData\\Spark’s Outpost');
    expect(valueOf(inner, 'want')).toBe('abc');
    expect(valueOf(inner, 'was')).toBe('missing');
    expect(inner).toContain("$target = 'C:\\ProgramData\\Spark’’s Outpost\\managed-settings.json'");
  });

  it('checks both digests and locks the folder to administrators before moving the file', () => {
    const inner = windowsInstallScript(install);
    const order = [
      "if ($was -eq 'missing')",
      'CreateDirectory($folder)',
      "SetSecurityDescriptorSddlForm('O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)')",
      '[IO.File]::Copy($source, $staged, $true)',
      'if ((Digest $staged) -ne $want)',
      '[IO.File]::Replace($staged, $target',
      "SetSecurityDescriptorSddlForm('O:BAG:SYD:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)')",
    ].map((part) => inner.indexOf(part));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(inner).toContain('{ exit 3 }');
    expect(inner).toContain('exit 4 }');
  });
});

describe('writing the company file on Windows', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'spark-managed-win-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  const failing =
    (code: number): ElevatedRunner =>
    async () => {
      throw Object.assign(new Error(`exit ${code}`), { code });
    };

  it('stages the text privately, hands its digest over and checks the result', async () => {
    const target = join(scratch, 'Spark Outpost', 'managed-settings.json');
    let seen: { text: string; mode: number; want: string; powershell: string } | null = null;
    const runner: ElevatedRunner = async (powershell, args) => {
      const inner = await installScriptOf(args);
      const source = valueOf(inner, 'source');
      seen = {
        text: await readFile(source, 'utf8'),
        mode: (await stat(source)).mode & 0o777,
        want: valueOf(inner, 'want'),
        powershell,
      };
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, seen.text);
    };
    await windowsManagedWrite('stale', runner, { SystemRoot: 'C:\\Windows' })(
      target,
      NEW_TEXT,
      'missing',
    );
    expect(seen).toMatchObject({ text: NEW_TEXT, want: hashOf(NEW_TEXT), powershell: POWERSHELL });
    if (process.platform !== 'win32') expect(seen!.mode).toBe(0o600);
    expect(await readFile(target, 'utf8')).toBe(NEW_TEXT);
  });

  it('refuses success when the file does not hold the approved text', async () => {
    const target = join(scratch, 'managed-settings.json');
    const write = windowsManagedWrite('stale', async () => {
      await writeFile(target, '{}\n');
    });
    await expect(write(target, NEW_TEXT, 'missing')).rejects.toThrow(NOT_WRITTEN_WINDOWS);
  });

  it('names a cancelled prompt, a stale file and changed staged text', async () => {
    const target = join(scratch, 'managed-settings.json');
    await expect(
      windowsManagedWrite('stale', failing(1223))(target, '{}', 'missing'),
    ).rejects.toThrow(CANCELLED_UAC);
    const stale = windowsManagedWrite('stale now', failing(3))(target, '{}', 'missing');
    await expect(stale).rejects.toThrow(StaleRulesError);
    await expect(
      windowsManagedWrite('stale now', failing(3))(target, '{}', 'missing'),
    ).rejects.toThrow('stale now');
    await expect(windowsManagedWrite('stale', failing(4))(target, '{}', 'missing')).rejects.toThrow(
      CHANGED_STAGED_WINDOWS,
    );
    await expect(windowsManagedWrite('stale', failing(6))(target, '{}', 'missing')).rejects.toThrow(
      SCRIPT_CHANGED_WINDOWS,
    );
    const odd = windowsManagedWrite('stale', async () => {
      throw Object.assign(new Error('Command failed: powershell.exe -EncodedCommand AAAA'), {
        code: 5,
      });
    })(target, '{}', 'missing');
    await expect(odd).rejects.toThrow("Windows couldn't change the company rules (exit 5)");
    await expect(odd).rejects.not.toThrow('-EncodedCommand');
  });

  it('removes the staged copy whatever happens', async () => {
    let source = '';
    const write = windowsManagedWrite('stale', async (_powershell, args) => {
      source = valueOf(await installScriptOf(args), 'source');
      throw Object.assign(new Error('cancelled'), { code: 1223 });
    });
    await expect(write(join(scratch, 'm.json'), '{}', 'missing')).rejects.toThrow(CANCELLED_UAC);
    await expect(stat(dirname(source))).rejects.toThrow();
  });
});
