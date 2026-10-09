import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTSIDE_FOLDER_REASON } from '../../approvals/spark-command.ts';
import { NO_SUCH_FOLDER_REASON, folderProblem, resolveFolder } from './terminal-run-folder.ts';

let base: string;
let root: string;
let elsewhere: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-terminal-folder-')));
  root = path.join(base, 'app');
  elsewhere = path.join(base, 'elsewhere');
  await mkdir(path.join(root, 'web'), { recursive: true });
  await mkdir(elsewhere);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const roots = () => [{ path: root }];

describe('the folder a Spark terminal starts in', () => {
  it('is the chat’s first root when none is named', () => {
    expect(resolveFolder(roots(), undefined)).toBe(root);
    expect(resolveFolder([], undefined)).toBeNull();
  });

  it('resolves a relative folder against the chat’s first root', () => {
    expect(resolveFolder(roots(), 'web')).toBe(path.join(root, 'web'));
    expect(resolveFolder(roots(), './web/../web')).toBe(path.join(root, 'web'));
    expect(resolveFolder(roots(), '../elsewhere')).toBe(elsewhere);
    expect(resolveFolder([], 'web')).toBeNull();
  });

  it('keeps an absolute folder, normalised', () => {
    expect(resolveFolder(roots(), `${root}/web/`)).toBe(path.join(root, 'web'));
    expect(resolveFolder(roots(), '/etc')).toBe('/etc');
  });
});

describe('a folder that cannot be used', () => {
  it('accepts the root and a folder under it', async () => {
    expect(await folderProblem(roots(), root)).toBeNull();
    expect(await folderProblem(roots(), path.join(root, 'web'))).toBeNull();
  });

  it('refuses a folder that does not exist, and a file', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'x');
    expect(await folderProblem(roots(), path.join(root, 'gone'))).toBe(NO_SUCH_FOLDER_REASON);
    expect(await folderProblem(roots(), path.join(root, 'notes.txt'))).toBe(NO_SUCH_FOLDER_REASON);
  });

  it('refuses a link inside the project that leads outside it', async () => {
    await symlink(elsewhere, path.join(root, 'out'));
    expect(await folderProblem(roots(), path.join(root, 'out'))).toBe(OUTSIDE_FOLDER_REASON);
  });

  it('accepts a project that is itself reached through a link', async () => {
    const linked = path.join(base, 'linked');
    await symlink(root, linked);
    expect(await folderProblem([{ path: linked }], path.join(linked, 'web'))).toBeNull();
  });
});
