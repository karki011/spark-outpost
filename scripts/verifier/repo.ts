import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VerifierCase } from './case.ts';

const BASE = fileURLToPath(new URL('../bench/fixture/base/', import.meta.url));
const HIDDEN_DIR = 'hidden-checks';
export const CHECK_COMMAND = 'node --test "test/**/*.test.ts"';

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.email=bench@spark.local', '-c', 'user.name=bench', ...args],
    { encoding: 'utf8' },
  );
}

function passes(repo: string, pattern: string): { passed: boolean; output: string } {
  const run = spawnSync('node', ['--test', pattern], { cwd: repo, encoding: 'utf8' });
  return { passed: run.status === 0, output: `${run.stdout}${run.stderr}`.slice(-2_000) };
}

export interface PreparedCase {
  repo: string;
  visible: boolean;
  hidden: boolean;
  diff: string;
  files: { path: string; additions: number; deletions: number }[];
}

export async function prepareCase(root: string, item: VerifierCase): Promise<PreparedCase> {
  const repo = join(root, `${item.task.id}-${item.variant}`);
  await rm(repo, { recursive: true, force: true });
  await mkdir(repo, { recursive: true });
  await cp(BASE, repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'Fixture');
  await item.task[item.variant](repo);
  git(repo, 'add', '-A');
  const diff = git(repo, 'diff', '--cached', 'HEAD');
  const files = git(repo, 'diff', '--cached', '--numstat', 'HEAD')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, path] = line.split('\t');
      return { path: path!, additions: Number(additions), deletions: Number(deletions) };
    });
  const visible = passes(repo, 'test/**/*.test.ts').passed;
  await mkdir(join(repo, HIDDEN_DIR));
  await writeFile(join(repo, HIDDEN_DIR, 'hidden.test.ts'), item.task.hidden);
  const hidden = passes(repo, `${HIDDEN_DIR}/*.test.ts`).passed;
  await rm(join(repo, HIDDEN_DIR), { recursive: true, force: true });
  return { repo, visible, hidden, diff, files };
}
