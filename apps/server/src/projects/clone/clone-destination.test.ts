import { mkdir, mkdtemp, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimDestination,
  CloneRefusedError,
  removeClaimed,
  resolveDestination,
  type DestinationRules,
} from './clone-destination.ts';

let base: string;
let home: string;
let outside: string;
let rules: DestinationRules;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-clone-dest-')));
  home = path.join(base, 'home');
  outside = path.join(base, 'outside');
  await mkdir(path.join(home, 'Documents', 'linked', 'src'), { recursive: true });
  await mkdir(path.join(home, 'data'), { recursive: true });
  await mkdir(outside);
  rules = {
    home,
    projectRoots: [path.join(home, 'Documents', 'linked')],
    reserved: [path.join(home, 'data')],
  };
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const resolve = (parent: string, name: string) => resolveDestination(parent, name, rules);
const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

describe('clone destination', () => {
  it('resolves a new folder under the home folder', async () => {
    expect(await resolve(path.join(home, 'Documents'), 'widgets')).toEqual({
      path: path.join(home, 'Documents', 'widgets'),
      state: 'missing',
    });
    expect((await resolve(home, 'widgets')).path).toBe(path.join(home, 'widgets'));
  });

  it.each(['../escape', 'a/b', '.git', '-flag', '', 'x'.repeat(101)])(
    'refuses the folder name %j',
    async (name) => {
      await expect(resolve(path.join(home, 'Documents'), name)).rejects.toThrow(CloneRefusedError);
    },
  );

  it('refuses a relative parent and a parent that is missing', async () => {
    await expect(resolve('Documents', 'widgets')).rejects.toThrow(/full path/);
    await expect(resolve(path.join(home, 'nope'), 'widgets')).rejects.toThrow(/doesn't exist/);
  });

  it('refuses a parent outside the home folder', async () => {
    await expect(resolve(outside, 'widgets')).rejects.toThrow(/inside your home folder/);
    await expect(resolve(base, 'widgets')).rejects.toThrow(/inside your home folder/);
  });

  it('refuses a parent that is a symlink leading out of the home folder', async () => {
    await symlink(outside, path.join(home, 'shortcut'));
    await expect(resolve(path.join(home, 'shortcut'), 'widgets')).rejects.toThrow(
      /inside your home folder/,
    );
  });

  it('follows a symlinked parent that stays inside the home folder', async () => {
    await symlink(path.join(home, 'Documents'), path.join(home, 'docs-link'));
    expect((await resolve(path.join(home, 'docs-link'), 'widgets')).path).toBe(
      path.join(home, 'Documents', 'widgets'),
    );
  });

  it('refuses a folder inside a linked project', async () => {
    await expect(resolve(path.join(home, 'Documents', 'linked'), 'widgets')).rejects.toThrow(
      /inside the project/,
    );
    await expect(resolve(path.join(home, 'Documents', 'linked', 'src'), 'widgets')).rejects.toThrow(
      /inside the project/,
    );
  });

  it("refuses Spark's own folders", async () => {
    await expect(resolve(path.join(home, 'data'), 'widgets')).rejects.toThrow(/own files/);
    await mkdir(path.join(home, 'repo', '.spark', 'worktrees'), { recursive: true });
    await expect(
      resolve(path.join(home, 'repo', '.spark', 'worktrees'), 'widgets'),
    ).rejects.toThrow(/own files/);
  });

  it('reports what is already at the destination', async () => {
    const documents = path.join(home, 'Documents');
    await mkdir(path.join(documents, 'empty'));
    await mkdir(path.join(documents, 'full'));
    await writeFile(path.join(documents, 'full', 'keep.txt'), 'mine');
    await writeFile(path.join(documents, 'file'), 'mine');
    await symlink(outside, path.join(documents, 'link'));
    expect((await resolve(documents, 'empty')).state).toBe('empty');
    expect((await resolve(documents, 'full')).state).toBe('occupied');
    expect((await resolve(documents, 'file')).state).toBe('occupied');
    expect((await resolve(documents, 'link')).state).toBe('occupied');
  });

  it('never claims an occupied destination', async () => {
    const full = path.join(home, 'Documents', 'full');
    await mkdir(full);
    await writeFile(path.join(full, 'keep.txt'), 'mine');
    await expect(claimDestination({ path: full, state: 'occupied' })).rejects.toThrow(
      /already exists and is not empty/,
    );
    await expect(claimDestination({ path: full, state: 'empty' })).rejects.toThrow(
      /already exists and is not empty/,
    );
    await expect(claimDestination({ path: full, state: 'missing' })).rejects.toThrow(
      /already exists and is not empty/,
    );
    expect(await exists(path.join(full, 'keep.txt'))).toBe(true);
  });

  it('removes only the directory it claimed', async () => {
    const target = path.join(home, 'Documents', 'widgets');
    const claimed = await claimDestination({ path: target, state: 'missing' });
    await writeFile(path.join(target, 'partial'), 'x');
    expect(await removeClaimed(target, claimed)).toBe('removed');
    expect(await exists(target)).toBe(false);
    expect(await removeClaimed(target, claimed)).toBe('missing');
  });

  it('leaves a different directory at the same path alone', async () => {
    const target = path.join(home, 'Documents', 'widgets');
    const claimed = await claimDestination({ path: target, state: 'missing' });
    await rename(target, `${target}-moved`);
    await mkdir(target);
    await writeFile(path.join(target, 'theirs.txt'), 'not ours');
    expect(await removeClaimed(target, claimed)).toBe('changed');
    expect(await exists(path.join(target, 'theirs.txt'))).toBe(true);
  });

  it('leaves a symlink that replaced the claimed directory alone', async () => {
    const target = path.join(home, 'Documents', 'widgets');
    const claimed = await claimDestination({ path: target, state: 'missing' });
    await rename(target, `${target}-moved`);
    await writeFile(path.join(outside, 'precious.txt'), 'keep');
    await symlink(outside, target);
    expect(await removeClaimed(target, claimed)).toBe('changed');
    expect(await exists(path.join(outside, 'precious.txt'))).toBe(true);
  });
});
