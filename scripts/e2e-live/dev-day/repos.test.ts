import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changedFiles, createRepo, fingerprint, git, snapshot } from './repos.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dev-day-repos-'));
  git(dir, 'init', '-q', '-b', 'main');
  await writeFile(join(dir, 'kept.txt'), 'kept\n');
  await writeFile(join(dir, 'doomed.txt'), 'doomed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'start');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it('records a deleted file instead of failing, and reports it as changed', async () => {
  const before = snapshot(dir);
  await rm(join(dir, 'doomed.txt'));
  const after = snapshot(dir);
  expect(after.files.has('doomed.txt')).toBe(true);
  expect(changedFiles(dir, before)).toEqual(['doomed.txt']);
});

it('fingerprints a repo without rewriting its index', async () => {
  const stale = new Date(Date.now() + 60_000);
  await utimes(join(dir, 'kept.txt'), stale, stale);
  const index = await readFile(join(dir, '.git', 'index'));
  fingerprint(dir);
  expect((await readFile(join(dir, '.git', 'index'))).equals(index)).toBe(true);
});

it('refuses to clone an external repo when none is configured', async () => {
  vi.stubEnv('DEV_DAY_EXTERNAL_REPO', '');
  await expect(createRepo('external', dir, 'external')).rejects.toThrow(/DEV_DAY_EXTERNAL_REPO/);
});
