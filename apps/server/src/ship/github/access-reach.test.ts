import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../persistence/db.ts';
import { memorySecretStore } from '../../setup/secrets.ts';
import { forgetGhCli, gitHubReachability, type GitHubDeps } from './access.ts';

vi.mock('../../persistence/github-tokens.ts', () => ({
  gitHubToken: async () => null,
  saveGitHubToken: async () => undefined,
  deleteGitHubToken: async () => undefined,
}));

let commands: string[];
let clockNow: number;
let signedIn: boolean;

function deps(): GitHubDeps {
  return {
    db: {} as Db,
    workspaceId: 'w',
    secrets: memorySecretStore(),
    fetch,
    locateGh: async () => {
      commands.push('locate');
      return '/usr/bin/gh';
    },
    runCommand: async () => runner(),
    now: () => clockNow,
  };
}

async function runner() {
  commands.push('auth');
  return signedIn
    ? { code: 0, stdout: 'Logged in to github.com account octo', stderr: '' }
    : { code: 1, stdout: '', stderr: 'not logged in' };
}

beforeEach(() => {
  commands = [];
  clockNow = 0;
  signedIn = true;
});

describe('gitHubReachability', () => {
  it('runs the gh lookup once within the ttl and again after it', async () => {
    const shared = deps();
    const first = await gitHubReachability(shared);
    clockNow = 59_999;
    await gitHubReachability(shared);
    expect(first).toEqual({ saved: false, ghLogin: 'octo' });
    expect(commands).toEqual(['locate', 'auth']);
    clockNow = 60_000;
    await gitHubReachability(shared);
    expect(commands).toEqual(['locate', 'auth', 'locate', 'auth']);
  });

  it('shares one lookup between concurrent callers', async () => {
    const shared = deps();
    await Promise.all([gitHubReachability(shared), gitHubReachability(shared)]);
    expect(commands).toEqual(['locate', 'auth']);
  });

  it('sees a new sign-in after invalidation or the ttl', async () => {
    const shared = deps();
    signedIn = false;
    expect((await gitHubReachability(shared)).ghLogin).toBeNull();
    signedIn = true;
    expect((await gitHubReachability(shared)).ghLogin).toBeNull();
    forgetGhCli(shared);
    expect((await gitHubReachability(shared)).ghLogin).toBe('octo');
  });
});
