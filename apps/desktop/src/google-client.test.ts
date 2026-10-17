import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packagedGoogleClient } from '../scripts/builder-config.ts';
import { googleClientFromDownload } from './google-client.ts';
import { bakedSignInEnv } from './slack-sign-in.ts';

const CLIENT_ID = '123456789012-abc123def456.apps.googleusercontent.com';
const DOWNLOAD = JSON.stringify({
  installed: {
    client_id: CLIENT_ID,
    client_secret: 'GOCSPX-desktopSecret_1',
    redirect_uris: ['http://localhost'],
  },
});

let dir = '';

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function folder(files: Record<string, string>): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-google-client-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

describe('the Google OAuth client', () => {
  it('reads the Desktop client file Google Cloud gives and refuses anything else', () => {
    expect(googleClientFromDownload(DOWNLOAD)).toEqual({
      clientId: CLIENT_ID,
      clientSecret: 'GOCSPX-desktopSecret_1',
      verified: false,
    });
    expect(googleClientFromDownload(JSON.stringify({ web: { client_id: CLIENT_ID } }))).toBeNull();
    expect(googleClientFromDownload('not json')).toBeNull();
    expect(
      googleClientFromDownload(
        JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }),
      ),
    ).toBeNull();
  });

  it('hands a dev build the client from .local, and a packaged build the baked one first', async () => {
    const appPath = await folder({
      'package.json': JSON.stringify({}),
      'google-oauth-client.json': DOWNLOAD,
    });
    expect(await bakedSignInEnv(appPath, path.join(appPath, 'google-oauth-client.json'))).toEqual({
      SPARK_GOOGLE_CLIENT_ID: CLIENT_ID,
      SPARK_GOOGLE_CLIENT_SECRET: 'GOCSPX-desktopSecret_1',
      SPARK_GOOGLE_VERIFIED: 'false',
    });
    expect(await bakedSignInEnv(appPath, path.join(appPath, 'missing.json'))).toEqual({});

    await writeFile(
      path.join(appPath, 'package.json'),
      JSON.stringify({
        googleApp: { client_id: CLIENT_ID, client_secret: 'GOCSPX-baked', verified: true },
      }),
    );
    expect(await bakedSignInEnv(appPath, null)).toMatchObject({
      SPARK_GOOGLE_CLIENT_SECRET: 'GOCSPX-baked',
      SPARK_GOOGLE_VERIFIED: 'true',
    });
  });

  it('bakes a packaged client only from SPARK_GOOGLE_CLIENT_FILE, and fails on a bad file', () => {
    expect(packagedGoogleClient({})).toBeNull();
    expect(packagedGoogleClient({ SPARK_GOOGLE_CLIENT_FILE: '/c.json' }, () => DOWNLOAD)).toEqual({
      clientId: CLIENT_ID,
      clientSecret: 'GOCSPX-desktopSecret_1',
      verified: false,
    });
    expect(
      packagedGoogleClient(
        { SPARK_GOOGLE_CLIENT_FILE: '/c.json', SPARK_GOOGLE_APP_VERIFIED: '1' },
        () => DOWNLOAD,
      )?.verified,
    ).toBe(true);
    expect(() => packagedGoogleClient({ SPARK_GOOGLE_CLIENT_FILE: '/c.json' }, () => '{}')).toThrow(
      /Desktop app OAuth client/,
    );
  });
});
