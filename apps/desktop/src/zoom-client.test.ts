import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packagedZoomClient } from '../scripts/builder-config.ts';
import { bakedServerEnv } from './baked-env.ts';
import { zoomClientFromFile } from './zoom-client.ts';

const CLIENT_ID = 'Ab3dEfGh1jKlMn0pQrStUv';
const FILE = JSON.stringify({ client_id: CLIENT_ID });

let dir = '';

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function folder(files: Record<string, string>): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-zoom-client-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

describe('the Zoom app client ID', () => {
  it('reads a client ID file and refuses anything else', () => {
    expect(zoomClientFromFile(FILE)).toBe(CLIENT_ID);
    expect(zoomClientFromFile(JSON.stringify({ client_id: 'has spaces' }))).toBeNull();
    expect(zoomClientFromFile(JSON.stringify({ client_secret: 'x' }))).toBeNull();
    expect(zoomClientFromFile('not json')).toBeNull();
  });

  it('hands the dev file to the server, and prefers the baked one', async () => {
    const appPath = await folder({ 'zoom-oauth-client.json': FILE });
    const files = {
      googleClientFile: null,
      slackClientIdFile: null,
      zoomClientFile: path.join(appPath, 'zoom-oauth-client.json'),
    };
    expect(await bakedServerEnv(appPath, files)).toEqual({ SPARK_ZOOM_CLIENT_ID: CLIENT_ID });
    const baked = 'Zz9yXwVu8tSrQp7oNmLkJi';
    await writeFile(
      path.join(appPath, 'package.json'),
      JSON.stringify({ zoomApp: { client_id: baked } }),
    );
    expect(await bakedServerEnv(appPath, files)).toEqual({ SPARK_ZOOM_CLIENT_ID: baked });
  });

  it('packages only a valid client file', () => {
    expect(packagedZoomClient({})).toBeNull();
    expect(packagedZoomClient({ SPARK_ZOOM_CLIENT_FILE: 'f' }, () => FILE)).toBe(CLIENT_ID);
    expect(() => packagedZoomClient({ SPARK_ZOOM_CLIENT_FILE: 'f' }, () => '{}')).toThrow(
      /SPARK_ZOOM_CLIENT_FILE/,
    );
  });
});
