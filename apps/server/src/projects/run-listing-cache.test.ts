import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListedFile } from './change-list.ts';
import { parseStatus, rangeSignature, RunListingCache } from './run-listing-cache.ts';

let root: string;
const IDENTITY = ['-c', 'user.email=t@t', '-c', 'user.name=t'];
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-listing-')));
  await writeFile(join(root, 'app.ts'), 'one\n');
  await writeFile(join(root, 'kept.ts'), 'kept\n');
  git('init', '-q');
  git(...IDENTITY, 'add', '.');
  git(...IDENTITY, 'commit', '-qm', 'base');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const live = () => rangeSignature({ root, from: 'snapshot', until: null });

async function changedBy(change: () => Promise<unknown> | unknown): Promise<boolean> {
  const before = await live();
  await change();
  const after = await live();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  return before !== after;
}

describe('working tree signature', () => {
  it('stays the same while nothing changes', async () => {
    await writeFile(join(root, 'app.ts'), 'two\n');
    await writeFile(join(root, 'new file.ts'), 'new\n');
    expect(await changedBy(() => undefined)).toBe(false);
  });

  it('changes when a file is edited, even to the same size with the same time', async () => {
    expect(await changedBy(() => writeFile(join(root, 'app.ts'), 'two\n'))).toBe(true);
    const stamp = new Date('2026-01-01T00:00:00Z');
    await utimes(join(root, 'app.ts'), stamp, stamp);
    expect(
      await changedBy(async () => {
        await writeFile(join(root, 'app.ts'), 'six\n');
        await utimes(join(root, 'app.ts'), stamp, stamp);
      }),
    ).toBe(true);
  });

  it('changes when a file appears, is removed, is staged or is put back', async () => {
    expect(await changedBy(() => writeFile(join(root, 'extra.ts'), 'extra\n'))).toBe(true);
    expect(await changedBy(() => git('add', 'extra.ts'))).toBe(true);
    expect(await changedBy(() => unlink(join(root, 'kept.ts')))).toBe(true);
    expect(await changedBy(() => git('checkout', '--', 'kept.ts'))).toBe(true);
  });

  it('changes when the commit or any ref moves', async () => {
    await writeFile(join(root, 'app.ts'), 'two\n');
    expect(await changedBy(() => git(...IDENTITY, 'commit', '-qam', 'next'))).toBe(true);
    expect(await changedBy(() => git('branch', 'side'))).toBe(true);
    expect(await changedBy(() => git('update-ref', 'refs/remotes/origin/main', 'HEAD'))).toBe(true);
  });

  it('tells two snapshots and a fixed range apart', async () => {
    const head = git('rev-parse', 'HEAD').trim();
    const first = await rangeSignature({ root, from: 'a', until: null });
    expect(await rangeSignature({ root, from: 'b', until: null })).not.toBe(first);
    const fixed = await rangeSignature({ root, from: 'a', until: head });
    expect(fixed).not.toBe(first);
    await writeFile(join(root, 'app.ts'), 'two\n');
    expect(await rangeSignature({ root, from: 'a', until: head })).toBe(fixed);
  });

  it('gives no signature for a nested repository or a folder that is not a repository', async () => {
    const nested = join(root, 'vendor/lib');
    await mkdir(nested, { recursive: true });
    execFileSync('git', ['init', '-q', nested]);
    await writeFile(join(nested, 'lib.ts'), 'lib\n');
    execFileSync('git', ['-C', nested, ...IDENTITY, 'add', '.']);
    execFileSync('git', ['-C', nested, ...IDENTITY, 'commit', '-qm', 'lib']);
    expect(await live()).toBeNull();
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'spark-plain-')));
    try {
      expect(await rangeSignature({ root: plain, from: 'a', until: null })).toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe('status paths', () => {
  it('reads changed, renamed, unmerged and untracked paths', () => {
    const hash = '1'.repeat(40);
    const output = [
      `# branch.oid ${hash}`,
      '# branch.head main',
      `1 .M N... 100644 100644 100644 ${hash} ${hash} src/with space.ts`,
      `2 R. N... 100644 100644 100644 ${hash} ${hash} R100 new name.ts`,
      'old name.ts',
      `u UU N... 100644 100644 100644 100644 ${hash} ${hash} ${hash} both.ts`,
      '? notes/todo list.md',
      '',
    ].join('\0');
    expect(parseStatus(output)).toEqual({
      paths: ['src/with space.ts', 'new name.ts', 'both.ts', 'notes/todo list.md'],
      exact: true,
    });
  });

  it('is not exact with a submodule or an untracked repository', () => {
    const hash = '1'.repeat(40);
    const submodule = `1 .M SC.. 160000 160000 160000 ${hash} ${hash} vendor/lib`;
    expect(parseStatus(`${submodule}\0`).exact).toBe(false);
    expect(parseStatus('? vendor/lib/\0').exact).toBe(false);
  });
});

describe('run listing cache', () => {
  const files = (name: string): ListedFile[] => [
    {
      file: {
        path: name,
        change: 'modified',
        added: 1,
        removed: 0,
        oldText: null,
        newText: null,
        shown: 'text',
      },
      contents: () => Promise.resolve({ before: null, after: null }),
    },
  ];

  it('returns a stored listing until it is ten minutes old', () => {
    let now = 0;
    const cache = new RunListingCache(() => now);
    const stored = files('a.ts');
    cache.set('one', stored);
    now = 10 * 60_000 - 1;
    expect(cache.get('one')).toBe(stored);
    now = 10 * 60_000;
    expect(cache.get('one')).toBeUndefined();
    expect(cache.get('other')).toBeUndefined();
  });

  it('drops the listing used longest ago once it holds too many', () => {
    const cache = new RunListingCache();
    for (let index = 0; index < 32; index += 1) cache.set(`key-${index}`, files(`${index}.ts`));
    expect(cache.get('key-0')).toBeDefined();
    cache.set('key-32', files('32.ts'));
    expect(cache.get('key-0')).toBeDefined();
    expect(cache.get('key-1')).toBeUndefined();
    expect(cache.get('key-32')).toBeDefined();
  });
});
