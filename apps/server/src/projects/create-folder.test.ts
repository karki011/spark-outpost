import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFolder } from './folders.ts';

let base: string;
let home: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-create-folder-')));
  home = join(base, 'home');
  await mkdir(join(home, 'Code'), { recursive: true });
  await mkdir(join(base, 'elsewhere'));
  await symlink(join(base, 'elsewhere'), join(home, 'link-out'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('making a new folder for a project', () => {
  it('makes the folder inside the parent and returns its path', async () => {
    const made = await createFolder(join(home, 'Code'), 'invoice-tool', home);
    expect(made).toBe(join(home, 'Code', 'invoice-tool'));
    expect((await stat(made)).isDirectory()).toBe(true);
  });

  it('may make a folder straight inside the home folder', async () => {
    expect(await createFolder(home, 'notes', home)).toBe(join(home, 'notes'));
  });

  it('refuses a folder that is already there', async () => {
    await expect(createFolder(join(home, 'Code'), 'invoice-tool', home)).rejects.toThrow(
      '“invoice-tool” is already there.',
    );
  });

  it('refuses parents outside the home folder, including through a link', async () => {
    await expect(createFolder(join(base, 'elsewhere'), 'x', home)).rejects.toThrow(
      'Make new folders inside your home folder.',
    );
    await expect(createFolder(join(home, 'link-out'), 'x', home)).rejects.toThrow(
      'Make new folders inside your home folder.',
    );
    await expect(createFolder('/', 'x', home)).rejects.toThrow(
      'Make new folders inside your home folder.',
    );
  });

  it('refuses a name that walks out of the parent', async () => {
    await expect(createFolder(join(home, 'Code'), '..', home)).rejects.toThrow(
      'Use a folder name, not a path.',
    );
    await expect(createFolder(join(home, 'Code'), '../../escape', home)).rejects.toThrow(
      'Use a folder name, not a path.',
    );
  });

  it('refuses a relative or missing parent', async () => {
    await expect(createFolder('Code', 'x', home)).rejects.toThrow(
      'Choose a folder by its full path.',
    );
    await expect(createFolder(join(home, 'gone'), 'x', home)).rejects.toThrow(
      "That folder doesn't exist.",
    );
  });
});
