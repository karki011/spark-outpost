import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStoredLaunch, sessionRoot, writeAdoptRecord, writeObserver } from './adopt-record.ts';
import { savedPort, savePort } from './stable-port.ts';

const record = { grant: 'a'.repeat(64), mcpPort: 50123, ceiling: 'acceptEdits' };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), 'sptx-adopt-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function launchDir(name: string): string {
  const directory = join(root, name);
  mkdirSync(directory);
  return directory;
}

describe('what a Terminal session keeps for re-adoption', () => {
  it('stores the grant digest, the tools port and the launch mode in a private file', async () => {
    const directory = launchDir('one');
    await writeAdoptRecord(directory, record);
    expect(statSync(join(directory, 'adopt.json')).mode & 0o777).toBe(0o600);
    expect(await readStoredLaunch(root)).toEqual({ directory, record, observed: false });
  });

  it('refuses to store anything that is not a sha256 digest', async () => {
    await expect(
      writeAdoptRecord(launchDir('one'), { ...record, grant: 'a-raw-token' }),
    ).rejects.toThrow();
  });

  it('picks the newest launch and says whether its hook credentials are there', async () => {
    const older = launchDir('older');
    const newer = launchDir('newer');
    await writeAdoptRecord(older, record);
    await writeAdoptRecord(newer, { ...record, ceiling: 'plan' });
    utimesSync(join(older, 'adopt.json'), new Date(1_000_000), new Date(1_000_000));
    await writeObserver(newer, {
      url: 'http://127.0.0.1:1/events',
      token: 't',
      sessionId: 's',
      provider: 'claude',
    });
    expect(await readStoredLaunch(root)).toMatchObject({
      directory: newer,
      observed: true,
      record: { ceiling: 'plan' },
    });
    expect(statSync(join(newer, 'observer.json')).mode & 0o777).toBe(0o600);
  });

  it('finds nothing in a folder with no readable record', async () => {
    writeFileSync(join(launchDir('bad'), 'adopt.json'), '{"grant":"nope"}');
    expect(await readStoredLaunch(root)).toBeNull();
    expect(await readStoredLaunch(join(root, 'missing'))).toBeNull();
  });

  it('keeps each session under its channel', () => {
    expect(sessionRoot('/data', 'spark-dev', 'abc')).toBe('/data/spark-dev/terminal-sessions/abc');
  });
});

describe('the Spark tools port kept across restarts', () => {
  it('remembers a port and ignores anything that is not one', () => {
    const file = join(root, 'nested', 'mcp-port');
    expect(savedPort(file)).toBe(0);
    savePort(file, 51234);
    expect(savedPort(file)).toBe(51234);
    writeFileSync(file, '80');
    expect(savedPort(file)).toBe(0);
    writeFileSync(file, 'not a port');
    expect(savedPort(file)).toBe(0);
  });
});
