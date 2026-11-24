import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packagedMicrosoftClient } from '../scripts/builder-config.ts';
import { bakedServerEnv } from './baked-env.ts';
import { microsoftClientFromFile } from './microsoft-client.ts';

const CLIENT_ID = '0f6c2a8e-3b1d-4c5e-9a7f-1e2d3c4b5a69';
const FILE = JSON.stringify({ client_id: CLIENT_ID });

let dir = '';

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function folder(files: Record<string, string>): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-microsoft-client-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

describe('the Microsoft app client ID', () => {
  it('reads a client ID file and refuses anything else', () => {
    expect(microsoftClientFromFile(FILE)).toBe(CLIENT_ID);
    expect(microsoftClientFromFile(JSON.stringify({ client_id: 'not-a-guid' }))).toBeNull();
    expect(microsoftClientFromFile(JSON.stringify({ client_secret: 'x' }))).toBeNull();
    expect(microsoftClientFromFile('not json')).toBeNull();
  });

  it('hands the dev file to the server, and prefers the baked one', async () => {
    const appPath = await folder({ 'microsoft-oauth-client.json': FILE });
    const files = {
      googleClientFile: null,
      microsoftClientFile: path.join(appPath, 'microsoft-oauth-client.json'),
      slackClientIdFile: null,
    };
    expect(await bakedServerEnv(appPath, files)).toEqual({ SPARK_MICROSOFT_CLIENT_ID: CLIENT_ID });
    expect(
      await bakedServerEnv(appPath, { ...files, microsoftClientFile: path.join(appPath, 'no') }),
    ).toEqual({});
    const baked = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    await writeFile(
      path.join(appPath, 'package.json'),
      JSON.stringify({ microsoftApp: { client_id: baked } }),
    );
    expect(await bakedServerEnv(appPath, files)).toEqual({ SPARK_MICROSOFT_CLIENT_ID: baked });
  });

  it('bakes a packaged client ID only from SPARK_MICROSOFT_CLIENT_FILE, and fails on a bad file', () => {
    expect(packagedMicrosoftClient({})).toBeNull();
    expect(packagedMicrosoftClient({ SPARK_MICROSOFT_CLIENT_FILE: '/m.json' }, () => FILE)).toBe(
      CLIENT_ID,
    );
    expect(() =>
      packagedMicrosoftClient({ SPARK_MICROSOFT_CLIENT_FILE: '/m.json' }, () => '{}'),
    ).toThrow('SPARK_MICROSOFT_CLIENT_FILE');
  });
});
