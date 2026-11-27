import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packagedCloudflareClient } from '../scripts/builder-config.ts';
import { bakedServerEnv } from './baked-env.ts';
import { cloudflareClientFromFile } from './cloudflare-client.ts';

const CLIENT_ID = 'a4d78d0dc7fff8786e067373dc0983fd';
const FILE = JSON.stringify({ client_id: CLIENT_ID });

let dir = '';

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function folder(files: Record<string, string>): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-cloudflare-client-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

describe('the Cloudflare sign-in client ID', () => {
  it('reads a client ID file and refuses anything else', () => {
    expect(cloudflareClientFromFile(FILE)).toBe(CLIENT_ID);
    expect(cloudflareClientFromFile(JSON.stringify({ client_id: 'has spaces' }))).toBeNull();
    expect(cloudflareClientFromFile('not json')).toBeNull();
  });

  it('hands the server the client ID only together with the share service’s code', async () => {
    const appPath = await folder({ 'client.json': FILE, 'share-worker.mjs': 'export default {}' });
    const files = {
      googleClientFile: null,
      slackClientIdFile: null,
      cloudflareClientFile: path.join(appPath, 'client.json'),
    };
    const workerFile = path.join(appPath, 'share-worker.mjs');
    expect(await bakedServerEnv(appPath, files)).toEqual({});
    expect(
      await bakedServerEnv(appPath, { ...files, shareWorkerFile: path.join(appPath, 'gone.mjs') }),
    ).toEqual({});
    expect(await bakedServerEnv(appPath, { ...files, shareWorkerFile: workerFile })).toEqual({
      SPARK_CLOUDFLARE_CLIENT_ID: CLIENT_ID,
      SPARK_SHARE_WORKER_FILE: workerFile,
    });
    const baked = 'b'.repeat(32);
    await writeFile(
      path.join(appPath, 'package.json'),
      JSON.stringify({ cloudflareApp: { client_id: baked } }),
    );
    expect(await bakedServerEnv(appPath, { ...files, shareWorkerFile: workerFile })).toMatchObject({
      SPARK_CLOUDFLARE_CLIENT_ID: baked,
    });
  });

  it('packages only a valid client file', () => {
    expect(packagedCloudflareClient({})).toBeNull();
    expect(packagedCloudflareClient({ SPARK_CLOUDFLARE_CLIENT_FILE: 'f' }, () => FILE)).toBe(
      CLIENT_ID,
    );
    expect(() =>
      packagedCloudflareClient({ SPARK_CLOUDFLARE_CLIENT_FILE: 'f' }, () => '{}'),
    ).toThrow(/SPARK_CLOUDFLARE_CLIENT_FILE/);
  });
});
