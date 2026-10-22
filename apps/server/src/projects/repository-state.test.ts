import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initRepository, repositoryState } from './git.ts';

let base: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-repository-state-')));
  await mkdir(join(base, 'plain'));
  await mkdir(join(base, 'repo'));
  execFileSync('git', ['init', '-q', join(base, 'repo')]);
  await mkdir(join(base, 'repo', 'inside'));
  await mkdir(join(base, 'broken'));
  await writeFile(join(base, 'broken', '.git'), 'not a gitdir line\n');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('repository state', () => {
  it('tells a plain folder from a repository and a folder inside one', async () => {
    expect(await repositoryState(join(base, 'plain'))).toEqual({
      repository: false,
      problem: null,
    });
    expect(await repositoryState(join(base, 'repo'))).toEqual({ repository: true, problem: null });
    expect((await repositoryState(join(base, 'repo', 'inside'))).repository).toBe(true);
  });

  it('reports other git failures as unknown, with git’s reason', async () => {
    const state = await repositoryState(join(base, 'broken'));
    expect(state.repository).toBeNull();
    expect(state.problem).toMatch(/gitfile/i);
  });

  it('makes only a definite plain folder a repository', async () => {
    await expect(initRepository(join(base, 'broken'))).rejects.toThrow(
      /Spark left this folder alone/,
    );
    await expect(initRepository(join(base, 'repo', 'inside'))).rejects.toThrow(
      'This folder is already a git repository.',
    );
    await initRepository(join(base, 'plain'));
    expect((await repositoryState(join(base, 'plain'))).repository).toBe(true);
  });
});
