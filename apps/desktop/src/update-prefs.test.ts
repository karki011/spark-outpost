import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadChannel, saveChannel, updatePrefsFile } from './update-prefs.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-updates-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('update channel preference', () => {
  it('starts on Stable and remembers Beta', async () => {
    const file = updatePrefsFile(dir);
    expect(await loadChannel(file)).toBe('stable');
    await saveChannel(file, 'beta');
    expect(await loadChannel(file)).toBe('beta');
  });

  it('falls back to Stable for a damaged or unknown file', async () => {
    const file = updatePrefsFile(dir);
    await writeFile(file, '{"channel":"nightly"}');
    expect(await loadChannel(file)).toBe('stable');
    await writeFile(file, 'not json');
    expect(await loadChannel(file)).toBe('stable');
  });
});
