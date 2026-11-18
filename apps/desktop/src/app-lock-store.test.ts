import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_LOCK_SETTINGS } from './app-lock-state.ts';
import {
  appLockFile,
  codeMatches,
  hashCode,
  readAppLockRecord,
  saveAppLockRecord,
} from './app-lock-store.ts';

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'app-lock-'));
  dirs.push(dir);
  return appLockFile(path.join(dir, 'profile'));
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the saved code', () => {
  it('matches only the code it was made from', async () => {
    const stored = await hashCode('042917');
    expect(await codeMatches('042917', stored)).toBe(true);
    expect(await codeMatches('042918', stored)).toBe(false);
  });

  it('is salted, so the same code is stored differently each time', async () => {
    const [first, second] = await Promise.all([hashCode('042917'), hashCode('042917')]);
    expect(first.hash).not.toBe(second.hash);
    expect(first.salt).not.toBe(second.salt);
  });
});

describe('the privacy screen file', () => {
  it('reads defaults when there is no file or it is not JSON', async () => {
    const file = await tempFile();
    const defaults = { settings: DEFAULT_APP_LOCK_SETTINGS, code: null };
    expect(readAppLockRecord(file)).toEqual(defaults);
    await saveAppLockRecord(file, defaults);
    await writeFile(file, 'not json');
    expect(readAppLockRecord(file)).toEqual(defaults);
  });

  it('keeps settings and the hashed code across a restart, readable only by the user', async () => {
    const file = await tempFile();
    const record = {
      settings: { ...DEFAULT_APP_LOCK_SETTINGS, enabled: true, idleMinutes: 15 as const },
      code: await hashCode('042917'),
    };
    await saveAppLockRecord(file, record);
    expect(readAppLockRecord(file)).toEqual(record);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain('042917');
  });

  it('saves at the same moment each land whole and leave only the file', async () => {
    const file = await tempFile();
    const records = await Promise.all(
      ['042917', '135790', '246810', '864209'].map(async (code, index) => ({
        settings: { ...DEFAULT_APP_LOCK_SETTINGS, enabled: index % 2 === 0 },
        code: await hashCode(code),
      })),
    );
    await Promise.all(records.map((record) => saveAppLockRecord(file, record)));
    expect(records).toContainEqual(readAppLockRecord(file));
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it('a save that fails leaves no temporary file behind', async () => {
    const file = await tempFile();
    await mkdir(file, { recursive: true });
    const record = { settings: DEFAULT_APP_LOCK_SETTINGS, code: null };
    await expect(saveAppLockRecord(file, record)).rejects.toThrow();
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });
});
