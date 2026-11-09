import { describe, expect, it } from 'vitest';
import { agentEnvironment, processEnvironment, withLoginShell } from './agent-env.ts';
import { agentDefinitions, scriptLaunch } from './agents.ts';

describe('an adapter launch', () => {
  it('runs the adapter script with the current runtime', () => {
    expect(
      scriptLaunch('/app/adapter.js', '/usr/local/bin/node', {
        node: '24.0.0',
      }),
    ).toEqual({
      command: '/usr/local/bin/node',
      args: ['/app/adapter.js'],
    });
  });

  it('asks the Electron runtime of the desktop app to behave as Node', () => {
    const versions = { node: '24.0.0', electron: '44.4.5' };
    expect(scriptLaunch('/app/adapter.js', '/Spark Outpost Helper', versions)).toEqual({
      command: '/Spark Outpost Helper',
      args: ['/app/adapter.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});

describe('the environment an agent session starts with', () => {
  const own = { PATH: '/usr/bin:/opt/homebrew/bin', HOME: '/Users/me' };

  it('adds what the login shell exports and the app was started without', () => {
    const login = { PATH: '/usr/bin', NPM_CONFIG_REGISTRY: 'https://npm.example.test/' };
    expect(withLoginShell(own, login)).toEqual({
      ...own,
      NPM_CONFIG_REGISTRY: 'https://npm.example.test/',
    });
  });

  it('keeps secret-looking names and parent agent settings out, as for the app variables', () => {
    const login = { NPM_TOKEN: 'npm_x', GITHUB_TOKEN: 'ghp_x', CLAUDECODE: '1', EDITOR: 'vim' };
    expect(withLoginShell(own, login)).toEqual({ ...own, EDITOR: 'vim' });
  });

  it('never takes from the login shell what changes where Spark, git or gh look', () => {
    const login = {
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
      CODEX_HOME: '/Users/me/.codex-work',
      NODE_OPTIONS: '--require /tmp/hook.js',
      GIT_DIR: '/elsewhere/.git',
      GIT_WORK_TREE: '/elsewhere',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/tmp/hooks',
      GH_REPO: 'someone/else',
      GH_HOST: 'github.example.test',
      GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work',
    };
    expect(withLoginShell(own, login)).toEqual({ ...own, GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' });
  });

  it('starts with the app environment when the login shell cannot be read', async () => {
    expect(withLoginShell(own, null)).toBe(own);
    const failing = () => Promise.reject(new Error('shell timed out'));
    const env = await processEnvironment({ loginEnv: failing });
    expect(env.SPARK_LOGIN_ONLY).toBeUndefined();
  });

  it('reads the login shell only when no environment was given', async () => {
    const login = () => Promise.resolve({ SPARK_LOGIN_ONLY: 'yes' });
    expect((await processEnvironment({ loginEnv: login })).SPARK_LOGIN_ONLY).toBe('yes');
    expect(await processEnvironment({ env: own, loginEnv: login })).toBe(own);
  });

  it('puts the login shell variables under the ones Spark sets for the session', async () => {
    const env = await agentEnvironment(
      {
        definition: agentDefinitions.claude,
        loginEnv: () =>
          Promise.resolve({ SPARK_LOGIN_ONLY: 'yes', CLAUDE_CODE_FORK_SUBAGENT: '0' }),
      },
      '/runs/1',
    );
    expect(env.SPARK_LOGIN_ONLY).toBe('yes');
    expect(env.CLAUDE_CODE_FORK_SUBAGENT).toBe('1');
  });
});
