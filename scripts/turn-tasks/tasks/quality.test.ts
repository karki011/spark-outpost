import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git } from './exec.ts';
import { taskById } from './index.ts';
import { NEW_NAME, OLD_NAME } from './quality.ts';
import { evidenceFor, replaceIn, testBench, type TestBench } from './test-support.ts';

const SLOW = 60_000;
let bench: TestBench;

beforeAll(async () => {
  bench = await testBench();
});

afterAll(async () => {
  await bench.remove();
});

const SLUGIFY = `
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
`;

describe('the quality checkers', () => {
  it(
    'task 1 fails at the start, passes on the real fix and fails when the test is edited',
    async () => {
      const task = taskById('1');
      const repo = await bench.copy('t1');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await replaceIn(repo, 'src/discount.ts', '/ 10)', '/ 100)');
      expect((await task.check(evidenceFor(repo))).pass).toBe(true);
      const cheat = await bench.copy('t1-cheat');
      await replaceIn(cheat, 'test/pricing/discount.spec.ts', '1800', '0');
      const verdict = await task.check(evidenceFor(cheat));
      expect(verdict.findings.map((item) => item.pass)).toEqual([true, false]);
    },
    SLOW,
  );

  it(
    'task 2 runs hidden tests it adds itself and leaves none behind',
    async () => {
      const task = taskById('2');
      const repo = await bench.copy('t2');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await writeFile(join(repo.path, 'src/text.ts'), SLUGIFY, { flag: 'a' });
      expect((await task.check(evidenceFor(repo))).pass).toBe(true);
      expect((await git(repo.path, 'status', '--porcelain')).output.trim()).toBe('M src/text.ts');
      await replaceIn(repo, 'src/text.ts', '/^-+|-+$/g', '/^-+/g');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
    },
    SLOW,
  );

  it(
    'task 3 wants the type check green, the old name gone and the new name used',
    async () => {
      const task = taskById('3');
      const repo = await bench.copy('t3');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await replaceIn(repo, 'src/totals.ts', OLD_NAME, NEW_NAME);
      const half = await task.check(evidenceFor(repo));
      expect(half.findings.map((item) => item.pass)).toEqual([false, false, true]);
      const files = (await git(repo.path, 'grep', '-l', '-w', OLD_NAME)).output.trim().split('\n');
      expect(files).toHaveLength(8);
      for (const file of files) await replaceIn(repo, file, new RegExp(OLD_NAME, 'g'), NEW_NAME);
      expect((await task.check(evidenceFor(repo))).pass).toBe(true);
    },
    SLOW,
  );

  it(
    'task 4 wants the file and the value in the reply and nothing changed',
    async () => {
      const task = taskById('4');
      const repo = await bench.copy('t4');
      const reply = 'It is 0.0825, defined in src/settings/region.ts.';
      expect((await task.check(evidenceFor(repo, { reply }))).pass).toBe(true);
      expect((await task.check(evidenceFor(repo, { reply: 'It is 8% in config.ts.' }))).pass).toBe(
        false,
      );
      await mkdir(join(repo.path, 'notes'));
      await writeFile(join(repo.path, 'notes/answer.md'), reply);
      const dirty = await task.check(evidenceFor(repo, { reply }));
      expect(dirty.findings.map((item) => item.pass)).toEqual([true, true, false]);
    },
    SLOW,
  );

  it(
    'task 5 fails on the fix that breaks the linter and passes on one that does not',
    async () => {
      const task = taskById('5');
      const repo = await bench.copy('t5');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await replaceIn(repo, 'src/stock.ts', 'count === null', 'count == null');
      const obvious = await task.check(evidenceFor(repo));
      expect(obvious.findings.map((item) => item.pass)).toEqual([true, false, true, true]);
      await replaceIn(
        repo,
        'src/stock.ts',
        'count == null',
        'count === null || count === undefined',
      );
      expect((await task.check(evidenceFor(repo))).pass).toBe(true);
      await replaceIn(repo, 'eslint.config.js', "'always'", "'smart'");
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
    },
    SLOW,
  );
});
