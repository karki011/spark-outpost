import { describe, expect, it } from 'vitest';
import { scriptLaunch } from './agents.ts';

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
