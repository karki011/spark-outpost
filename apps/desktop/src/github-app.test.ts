import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitHubAppEnv, gitHubAppIds, readBakedGitHubApp } from './github-app.ts';

let dir = '';

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function manifest(content: object): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-github-app-'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(content));
  return dir;
}

describe('the GitHub App ids baked into a build', () => {
  it('reads the client ID and slug from the packaged manifest', async () => {
    const appPath = await manifest({ githubApp: { clientId: 'Iv23liExample', slug: 'spark' } });
    const ids = await readBakedGitHubApp(appPath);
    expect(ids).toEqual({ clientId: 'Iv23liExample', slug: 'spark' });
    expect(gitHubAppEnv(ids)).toEqual({
      SPARK_GITHUB_APP_CLIENT_ID: 'Iv23liExample',
      SPARK_GITHUB_APP_SLUG: 'spark',
    });
  });

  it('gives nothing when the build has none or the values look wrong', async () => {
    expect(await readBakedGitHubApp(await manifest({}))).toBeNull();
    expect(gitHubAppIds('has spaces', 'spark')).toBeNull();
    expect(gitHubAppIds('Iv23liExample', 'not/a/slug')).toEqual({
      clientId: 'Iv23liExample',
      slug: '',
    });
    expect(gitHubAppEnv(null)).toEqual({});
  });
});
