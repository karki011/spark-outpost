import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git, node } from '../tasks/exec.ts';
import { testBench, type TestBench } from '../tasks/test-support.ts';
import { buildGolden, removeCopy } from './create.ts';
import { targetPath, templateFiles } from './files.ts';

const SLOW = 60_000;
let bench: TestBench;

beforeAll(async () => {
  bench = await testBench();
});

afterAll(async () => {
  await bench.remove();
});

describe('template files', () => {
  it('drop the template suffix and turn dot- names into dot files', () => {
    expect(targetPath('src/money.ts.tpl')).toBe('src/money.ts');
    expect(targetPath('dot-env.tpl')).toBe('.env');
    expect(targetPath('dot-gitignore.tpl')).toBe('.gitignore');
    expect(() => targetPath('src/money.ts')).toThrow('not a template');
  });

  it('hold a project with a test suite, a linter, a type check, an .env and an AGENTS.md', async () => {
    const targets = (await templateFiles()).map((file) => file.target);
    expect(targets).toEqual(
      expect.arrayContaining([
        '.env',
        '.gitignore',
        'AGENTS.md',
        'eslint.config.js',
        'package.json',
        'tsconfig.json',
        'scripts/ticker.mjs',
        'scripts/slow-check.mjs',
        'scripts/dev-server.mjs',
      ]),
    );
  });
});

describe('the scratch repository', () => {
  it(
    'starts every copy from the same commit, clean and with no remote',
    async () => {
      const first = await bench.copy('one');
      const again = await buildGolden(join(bench.base, 'second-base'));
      const second = await bench.copy('two');
      expect(first.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(again.commit).toBe(first.commit);
      expect(second.commit).toBe(first.commit);
      expect(second.path).not.toBe(first.path);
      expect((await git(first.path, 'status', '--porcelain')).output).toBe('');
      expect((await git(first.path, 'remote')).output).toBe('');
      expect((await git(first.path, 'branch', '--show-current')).output.trim()).toBe('main');
    },
    SLOW,
  );

  it(
    'has only a fake value in .env',
    async () => {
      const repo = await bench.copy('env');
      const env = await readFile(join(repo.path, '.env'), 'utf8');
      expect(env.trim()).toBe('API_TOKEN=fake-ledger-token-not-real-0000');
    },
    SLOW,
  );

  it(
    'type-checks and lints at the start, with the pricing and stock suites failing',
    async () => {
      const repo = await bench.copy('state');
      const exit = async (args: string[]) => (await node(args, repo.path)).code;
      expect(await exit([repo.toolchain.tsc, '--noEmit'])).toBe(0);
      expect(await exit([repo.toolchain.eslint, '.'])).toBe(0);
      expect(await exit(['--test', 'test/pricing/*.spec.ts'])).toBe(1);
      expect(await exit(['--test', 'test/stock/*.spec.ts'])).toBe(1);
      expect(await exit(['--test', 'test/text/*.spec.ts'])).toBe(0);
    },
    SLOW,
  );

  it(
    'shortens the long scripts with a flag for dry runs',
    async () => {
      const repo = await bench.copy('scripts');
      const ticker = await node(['scripts/ticker.mjs', '--seconds=1'], repo.path);
      expect(ticker.output).toMatch(/tick 1 of 1\nticker finished 1\/1 token [0-9a-f]{8}\n$/);
      const check = await node(['scripts/slow-check.mjs', '--seconds=0'], repo.path);
      expect(check.code).toBe(1);
      expect(check.output).toContain('duplicate sku B-200');
      expect(check.output).toContain('bad price -2400 for C-310');
      expect((await git(repo.path, 'status', '--porcelain')).output).toBe('');
    },
    SLOW,
  );

  it(
    'refuses to work outside a temp folder and removes a copy on request',
    async () => {
      await expect(buildGolden(join(import.meta.dirname, 'nope'))).rejects.toThrow('temp folder');
      const repo = await bench.copy('gone');
      await removeCopy(repo);
      expect((await git(join(repo.path, '..'), 'status')).code).not.toBe(0);
    },
    SLOW,
  );
});
