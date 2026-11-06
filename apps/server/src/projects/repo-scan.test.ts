import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { originUrlIn, repoMatch, scanRepos, type RepoScanLimits } from './repo-scan.ts';

let base: string;

const limits = (change: Partial<RepoScanLimits> = {}): RepoScanLimits => ({
  maxDepth: 3,
  maxEntries: 10_000,
  deadline: Number.POSITIVE_INFINITY,
  now: () => 0,
  ...change,
});

async function repo(folder: string, origin: string | null): Promise<void> {
  await mkdir(join(folder, '.git'), { recursive: true });
  const remote = origin ? `[remote "origin"]\n\turl = ${origin}\n` : '';
  await writeFile(join(folder, '.git', 'config'), `[core]\n\tbare = false\n${remote}`);
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-repo-scan-')));
  await repo(join(base, 'code', 'feature-identity'), 'git@github.com:acme/identity.git');
  await repo(join(base, 'code', 'id-svc'), 'https://github.com/acme/identity-service.git');
  await repo(join(base, 'code', 'billing'), null);
  await mkdir(join(base, 'code', 'billing', 'nested'), { recursive: true });
  await repo(join(base, 'code', 'billing', 'nested', 'inner'), null);
  await repo(join(base, 'a', 'b', 'deep-three'), null);
  await repo(join(base, 'a', 'b', 'c', 'deep-four'), null);
  await repo(join(base, 'code', 'node_modules', 'dep'), null);
  await repo(join(base, 'code', '.hidden', 'secret-repo'), null);
  await repo(join(base, 'skipme', 'skipped-repo'), null);
  await mkdir(join(base, 'worktrees', 'wt'), { recursive: true });
  await writeFile(join(base, 'code', 'id-svc', '.git', 'commondir'), '.\n');
  await mkdir(join(base, 'code', 'id-svc', '.git', 'worktrees', 'wt'), { recursive: true });
  await writeFile(join(base, 'code', 'id-svc', '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
  await writeFile(
    join(base, 'worktrees', 'wt', '.git'),
    `gitdir: ${join(base, 'code', 'id-svc', '.git', 'worktrees', 'wt')}\n`,
  );
  await symlink(join(base, 'code'), join(base, 'link-to-code'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function byPath(scan: Awaited<ReturnType<typeof scanRepos>>) {
  return Object.fromEntries(scan.repos.map((found) => [found.path.slice(base.length), found]));
}

describe('scanning repos folders for git repositories', () => {
  it('finds repos up to three levels deep and reads their origin', async () => {
    const scan = await scanRepos([base], [join(base, 'skipme')], limits());
    const found = byPath(scan);
    expect(Object.keys(found).sort()).toEqual([
      '/a/b/deep-three',
      '/code/billing',
      '/code/feature-identity',
      '/code/id-svc',
      '/worktrees/wt',
    ]);
    expect(found['/code/feature-identity']!.origin).toBe('acme/identity');
    expect(found['/code/billing']!.origin).toBeNull();
    expect(found['/worktrees/wt']!.origin).toBe('acme/identity-service');
    expect(scan.partial).toBe(false);
  });

  it('counts a repos folder that is itself a repo', async () => {
    const scan = await scanRepos([join(base, 'code', 'billing')], [], limits());
    expect(scan.repos.map((found) => found.path)).toEqual([join(base, 'code', 'billing')]);
  });

  it('stops at the entry cap or the deadline and says the scan is partial', async () => {
    const capped = await scanRepos([base], [], limits({ maxEntries: 1 }));
    expect(capped.partial).toBe(true);
    let clock = 0;
    const late = await scanRepos([base], [], limits({ deadline: 2, now: () => clock++ }));
    expect(late.partial).toBe(true);
  });

  it('lists a repo once when two repos folders overlap', async () => {
    const scan = await scanRepos([base, join(base, 'code')], [], limits());
    const paths = scan.repos.map((found) => found.path);
    expect(paths.length).toBe(new Set(paths).size);
  });
});

describe('matching a repo by name', () => {
  const renamed = {
    name: 'feature-identity',
    path: '/x/feature-identity',
    origin: 'acme/identity',
  };

  it('matches a renamed clone by its origin, exactly', () => {
    expect(repoMatch(renamed, 'Identity')).toBe('exact');
    expect(repoMatch(renamed, 'acme/identity')).toBe('exact');
  });

  it('matches part of a folder name, case-insensitively', () => {
    expect(repoMatch({ name: 'id-svc', path: '/x/id-svc', origin: null }, 'SVC')).toBe('partial');
    expect(repoMatch(renamed, 'billing')).toBeNull();
    expect(repoMatch(renamed, '  ')).toBeNull();
  });

  it('reads only the origin remote from a git config', () => {
    const config =
      '[remote "upstream"]\n\turl = a\n[remote "origin"]\n\turl = b\n[branch "main"]\n';
    expect(originUrlIn(config)).toBe('b');
    expect(originUrlIn('[core]\n')).toBeNull();
  });
});
