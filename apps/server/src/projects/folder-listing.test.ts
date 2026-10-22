import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessProblem, listFolders } from './folders.ts';

let base: string;
let home: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-folder-listing-')));
  home = join(base, 'home');
  await mkdir(join(home, 'Desktop'), { recursive: true });
  await mkdir(join(home, 'Documents', 'shop', '.git'), { recursive: true });
  await mkdir(join(home, 'Documents', 'notes'));
  await mkdir(join(home, 'Locked'));
  await chmod(join(home, 'Locked'), 0o000);
});

afterAll(async () => {
  await chmod(join(home, 'Locked'), 0o755);
  await rm(base, { recursive: true, force: true });
});

describe('the folder picker listing', () => {
  it('starts in Documents and marks git repositories', async () => {
    const listing = await listFolders(undefined, { home });
    expect(listing.path).toBe(join(home, 'Documents'));
    expect(listing.folders).toEqual([
      { name: 'notes', path: join(home, 'Documents', 'notes'), repository: false },
      { name: 'shop', path: join(home, 'Documents', 'shop'), repository: true },
    ]);
    expect(listing.denied).toBeNull();
  });

  it('offers Home and the quick places that exist', async () => {
    const listing = await listFolders(home, { home });
    const named = listing.places.filter((place) => !place.path.startsWith('/Volumes/'));
    expect(named).toEqual([
      { name: 'Home', path: home },
      { name: 'Desktop', path: join(home, 'Desktop') },
      { name: 'Documents', path: join(home, 'Documents') },
    ]);
    expect(listing.places.some((place) => place.path === '/Volumes/Macintosh HD')).toBe(false);
  });

  it('starts at home when there is no Documents folder', async () => {
    const bare = join(base, 'bare');
    await mkdir(bare);
    expect((await listFolders(undefined, { home: bare })).path).toBe(bare);
  });

  it('says how to allow access when the folder cannot be read, keeping the places', async () => {
    const listing = await listFolders(join(home, 'Locked'), { home });
    expect(listing.folders).toEqual([]);
    expect(listing.denied).toContain('permission');
    expect(listing.parent).toBe(home);
    expect(listing.places[0]).toEqual({ name: 'Home', path: home });
  });

  it('points to macOS privacy settings only when macOS refused the folder', () => {
    expect(accessProblem('EPERM')).toContain('Privacy & Security');
    expect(accessProblem('EACCES')).toContain('permission');
    expect(accessProblem('EIO')).toBeNull();
  });
});
