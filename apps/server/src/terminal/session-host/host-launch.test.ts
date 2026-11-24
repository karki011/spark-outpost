import { describe, expect, it } from 'vitest';
import { HOST_ENTRY, nodeLauncher } from './host-launch.ts';

const running = {
  execPath: '/usr/local/bin/node',
  execArgv: ['--watch', '--env-file-if-exists=../../.local/credentials.env', '--import', 'tsx'],
  argv: ['/usr/local/bin/node', '/repo/apps/server/src/api/main.ts'],
  versions: {},
  env: { PATH: '/usr/bin', GITHUB_TOKEN: 'secret', HOME: '/Users/me' },
};

describe('starting the session host process', () => {
  it('runs the host entry with the loader flags of a plain Node process, without watch or env files', () => {
    const launcher = nodeLauncher(running);
    expect(launcher.file).toBe('/usr/local/bin/node');
    expect(launcher.args).toEqual(['--import', 'tsx', HOST_ENTRY]);
    expect(launcher.env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me' });
  });

  it('runs the host entry through the server bootstrap in the packaged app', () => {
    const launcher = nodeLauncher({
      ...running,
      execPath: 'C:\\Program Files\\Spark Outpost\\Spark Outpost.exe',
      execArgv: [],
      argv: ['C:\\Program Files\\Spark Outpost\\Spark Outpost.exe', 'C:\\app\\server-entry.js'],
      versions: { electron: '41.0.0' },
    });
    expect(launcher.args).toEqual(['C:\\app\\server-entry.js', HOST_ENTRY]);
    expect(launcher.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(launcher.env).not.toHaveProperty('GITHUB_TOKEN');
  });
});
