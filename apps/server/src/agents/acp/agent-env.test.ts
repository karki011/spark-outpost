import { describe, expect, it } from 'vitest';
import { agentDefinitions, scriptLaunch } from './agents.ts';
import { NO_PUSH_URL, agentEnvironment, withoutPublishing } from './agent-env.ts';

describe('a Builder agent process', () => {
  it('rewrites every push URL, logs gh out and drops hosting tokens', () => {
    const env = withoutPublishing(
      { PATH: '/bin', GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'ghp_y', HOME: '/h' },
      '/runs/1',
    );
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${NO_PUSH_URL}.pushInsteadOf`,
      GIT_CONFIG_VALUE_0: '',
      GH_CONFIG_DIR: '/runs/1/.spark-outpost-no-gh',
    });
  });

  it('adds its rule after git config entries already in the environment', () => {
    const env = withoutPublishing(
      { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'cat' },
      '/w',
    );
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.pager',
      GIT_CONFIG_KEY_1: `url.${NO_PUSH_URL}.pushInsteadOf`,
      GIT_CONFIG_VALUE_1: '',
    });
  });

  it('applies only to Builders', async () => {
    const options = { definition: agentDefinitions.claude, env: { PATH: '/bin' } };
    expect(await agentEnvironment(options, '/w')).toEqual({ PATH: '/bin' });
    expect(await agentEnvironment(options, '/w', false, null, true)).toMatchObject({
      GIT_CONFIG_COUNT: '1',
    });
  });
});

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
