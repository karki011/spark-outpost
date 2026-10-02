import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs, updatePrefsFile } from './update-prefs.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-updates-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('update preferences', () => {
  it('start on Stable with automatic downloads and remember changes', async () => {
    const file = updatePrefsFile(dir);
    expect(await loadPrefs(file, '0.2.0')).toEqual({ channel: 'stable', autoDownload: true });
    await savePrefs(file, { channel: 'beta', autoDownload: false });
    expect(await loadPrefs(file, '0.2.0')).toEqual({ channel: 'beta', autoDownload: false });
  });

  it('fall back to the defaults for a damaged or unknown file', async () => {
    const file = updatePrefsFile(dir);
    await writeFile(file, '{"channel":"nightly","autoDownload":"yes"}');
    expect(await loadPrefs(file, '0.2.0')).toEqual({ channel: 'stable', autoDownload: true });
    await writeFile(file, 'not json');
    expect(await loadPrefs(file, '0.2.0')).toEqual({ channel: 'stable', autoDownload: true });
  });

  it('start beta builds on the Beta channel until the user picks one', async () => {
    const file = updatePrefsFile(dir);
    expect(await loadPrefs(file, '0.1.0-beta.1')).toEqual({ channel: 'beta', autoDownload: true });
    await savePrefs(file, { channel: 'stable', autoDownload: true });
    expect(await loadPrefs(file, '0.1.0-beta.2')).toEqual({
      channel: 'stable',
      autoDownload: true,
    });
  });
});
