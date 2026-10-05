import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloneOptionsSchema } from '@spark-outpost/contracts';
import { saveToken } from '../src/ship/github/access.ts';
import { signIn, startAppWorld, type AppWorld } from './github-app-support.ts';

const PAT = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop';

let world: AppWorld;

beforeEach(async () => {
  world = await startAppWorld();
});

afterEach(async () => {
  await world.close();
});

const options = async () =>
  cloneOptionsSchema.parse((await world.get('/api/project-clones/options').expect(200)).body);

describe('repositories offered for cloning', () => {
  it('offers none without a GitHub connection', async () => {
    expect(await options()).toMatchObject({ connected: false, repos: [], listError: null });
  });

  it('lists the repositories a saved token can see', async () => {
    await saveToken(world.deps(), PAT);
    world.stub.github.userRepos.splice(0, Infinity, 'acme/widgets', 'octo/notes');
    expect(await options()).toMatchObject({
      connected: true,
      truncated: false,
      repos: [
        { slug: 'acme/widgets', url: 'https://github.com/acme/widgets.git' },
        { slug: 'octo/notes', url: 'https://github.com/octo/notes.git' },
      ],
    });
  });

  it('lists the repositories the GitHub sign-in was given', async () => {
    world.stub.github.app.repos = ['acme/widgets', 'acme/private'];
    await signIn(world);
    const found = await options();
    expect(found.connected).toBe(true);
    expect(found.repos.map((repo) => repo.slug).sort()).toEqual(['acme/private', 'acme/widgets']);
    expect(JSON.stringify(found)).not.toMatch(/gh[ur]_/);
  });
});
