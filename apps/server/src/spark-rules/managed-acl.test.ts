import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rulesViewWithAcl } from '../persistence/spark-rules.ts';
import {
  aclScript,
  looseWriters,
  managedAclProblem,
  parseAclLines,
  type AclLine,
} from './managed-acl.ts';
import { loadSparkRules } from './rules-store.ts';

const ADMINS = 'S-1-5-32-544';
const SYSTEM = 'S-1-5-18';
const USERS = 'S-1-5-32-545';
const ADA = 'S-1-5-21-1-2-3-1001';

const strict = [
  `file|owner|${ADMINS}|0|0|BUILTIN\\Administrators`,
  `file|allow|${SYSTEM}|2032127|0|NT AUTHORITY\\SYSTEM`,
  `file|allow|${ADMINS}|2032127|0|BUILTIN\\Administrators`,
  `file|allow|${USERS}|1179817|0|BUILTIN\\Users`,
  `folder|owner|${ADMINS}|0|0|BUILTIN\\Administrators`,
  `folder|allow|${ADMINS}|2032127|0|BUILTIN\\Administrators`,
  `folder|allow|${USERS}|1179817|0|BUILTIN\\Users`,
];

const lines = (extra: string[] = []): AclLine[] =>
  parseAclLines([...strict, ...extra].join('\r\n'));

describe('who can change the company rules file on Windows', () => {
  it('is nobody but administrators, SYSTEM and TrustedInstaller in the strict layout', () => {
    expect(looseWriters(lines())).toEqual([]);
  });

  it('names Users when they can write the file', () => {
    expect(looseWriters(lines([`file|allow|${USERS}|278|0|BUILTIN\\Users`]))).toEqual([
      'BUILTIN\\Users',
    ]);
  });

  it('names an owner who is not an administrator group', () => {
    expect(looseWriters(lines([`file|owner|${ADA}|0|0|PC\\ada`]))).toEqual(['PC\\ada']);
  });

  it('counts deleting the file from the folder and taking ownership, not adding files', () => {
    expect(looseWriters(lines([`folder|allow|${USERS}|6|0|BUILTIN\\Users`]))).toEqual([]);
    expect(looseWriters(lines([`folder|allow|${USERS}|64|0|BUILTIN\\Users`]))).toEqual([
      'BUILTIN\\Users',
    ]);
    expect(looseWriters(lines([`file|allow|${USERS}|524288|0|BUILTIN\\Users`]))).toHaveLength(1);
  });

  it('reads generic rights stored as negative numbers and skips inherit-only rules', () => {
    expect(looseWriters(lines([`file|allow|${USERS}|-1073741824|0|BUILTIN\\Users`]))).toHaveLength(
      1,
    );
    expect(looseWriters(lines([`folder|allow|${USERS}|268435456|1|CREATOR OWNER`]))).toEqual([]);
  });

  it('ignores deny rules and lines it does not know', () => {
    expect(
      looseWriters(lines([`file|deny|${USERS}|278|0|x`, 'garbage', 'file|allow|x|y|0'])),
    ).toEqual([]);
  });

  it('builds a script that quotes the path', () => {
    const script = aclScript("C:\\ProgramData\\Spark's Outpost\\managed-settings.json");
    expect(script).toContain(
      "Get-Acl -LiteralPath 'C:\\ProgramData\\Spark''s Outpost\\managed-settings.json'",
    );
    expect(script).toContain("Get-Acl -LiteralPath 'C:\\ProgramData\\Spark''s Outpost'");
  });
});

describe('the loose company file problem', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'spark-acl-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('is checked only when the file exists, and once per change', async () => {
    const file = join(scratch, 'managed-settings.json');
    const read = vi.fn(async () =>
      [...strict, `file|allow|${USERS}|278|0|BUILTIN\\Users`].join('\n'),
    );
    expect(await managedAclProblem(file, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    await writeFile(file, '{}');
    const problem = await managedAclProblem(file, read);
    expect(problem).toContain(
      "Accounts that aren't administrators can change managed-settings.json",
    );
    expect(problem).toContain('BUILTIN\\Users');
    expect(await managedAclProblem(file, read)).toBe(problem);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when the permissions cannot be read', async () => {
    const file = join(scratch, 'managed-settings.json');
    await writeFile(file, '{}');
    expect(await managedAclProblem(file, () => Promise.reject(new Error('no')))).toBeNull();
  });

  it('adds the problem to the company file on Windows only', async () => {
    const files = {
      user: join(scratch, 'settings.json'),
      managed: 'C:\\ProgramData\\SparkOutpost\\managed-settings.json',
    };
    const loaded = await loadSparkRules({ ...files, managed: join(scratch, 'none.json') });
    const check = vi.fn(async () => 'loose');
    const windows = await rulesViewWithAcl(loaded, files, 'win32', check);
    expect(windows.problems).toContainEqual({ file: 'managed', message: 'loose' });
    const mac = await rulesViewWithAcl(loaded, files, 'darwin', check);
    expect(mac.problems).toEqual([]);
    const elsewhere = { ...files, managed: 'C:\\Temp\\managed-settings.json' };
    expect((await rulesViewWithAcl(loaded, elsewhere, 'win32', check)).problems).toEqual([]);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
