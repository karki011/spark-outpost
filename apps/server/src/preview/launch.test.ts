import { describe, expect, it } from 'vitest';
import { API_TOKEN_ENV } from '@spark-outpost/contracts';
import {
  freePortFrom,
  lastLines,
  logTail,
  plainOutput,
  portOf,
  previewEnvironment,
  printedPorts,
  probeTargets,
  withPort,
  workingFolder,
} from './launch.ts';

describe('preview environment', () => {
  it('never carries Spark’s launch token, database, keys or its own ports', () => {
    const env = previewEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/Users/sam',
        [API_TOKEN_ENV]: 'launch-token-launch-token-launch-token',
        DATABASE_URL: 'postgres://spark:pw@127.0.0.1/spark',
        TEST_DATABASE_URL: 'postgres://spark:pw@127.0.0.1/test',
        ANTHROPIC_API_KEY: 'sk-ant',
        GITHUB_TOKEN: 'ghp',
        MEMORY_SECRETS: '1',
        CLAUDECODE: '1',
        API_PORT: '37311',
        SPARK_DATA_DIR: '/data',
        WEB_ROOT: '/web',
        ALLOWED_ORIGINS: 'http://127.0.0.1:37311',
        PORT: '9',
        NODE_OPTIONS: '--inspect',
      },
      5180,
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/sam',
      NODE_OPTIONS: '--inspect',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PORT: '5180',
    });
  });
});

describe('preview ports', () => {
  it('reads and replaces the port of an address', () => {
    expect(portOf('http://localhost:5173/app')).toBe(5173);
    expect(portOf('http://site.test/')).toBe(80);
    expect(withPort('http://localhost:5173/app?x=1', 5174)).toBe('http://localhost:5174/app?x=1');
  });

  it('takes the next free port and remembers the busy ones', async () => {
    const taken = new Set([5173, 5174]);
    expect(await freePortFrom(5173, async (port) => !taken.has(port))).toEqual({
      port: 5175,
      busy: [5173, 5174],
    });
    expect(await freePortFrom(5173, async () => false)).toBeNull();
  });

  it('finds the address a dev server printed, newest first, through colour codes', () => {
    const output =
      '\u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m5175\u001b[22m/\u001b[39m\r\n' +
      '  proxy http://127.0.0.1:9000 ready\r\n  Network: http://192.168.1.4:5175/\r\n';
    expect(plainOutput(output)).toContain('Local:   http://localhost:5175/');
    expect(printedPorts(output)).toEqual([9000, 5175]);
  });

  it('probes the chosen port first, then printed ones, never a port that was busy', () => {
    const config = { url: 'http://localhost:5173/app', readyUrl: 'http://localhost:5173/health' };
    expect(
      probeTargets(
        config,
        5174,
        [5173],
        'Local: http://localhost:5173/ and http://localhost:5176/',
      ),
    ).toEqual([
      { probe: 'http://localhost:5174/health', url: 'http://localhost:5174/app' },
      { probe: 'http://localhost:5176/health', url: 'http://localhost:5176/app' },
    ]);
    expect(probeTargets({ url: 'http://localhost:3000', readyUrl: null }, 3000, [], '')).toEqual([
      { probe: 'http://localhost:3000/', url: 'http://localhost:3000/' },
    ]);
  });
});

describe('preview folders and logs', () => {
  it('keeps the working folder inside the project', () => {
    expect(workingFolder('/repo', null)).toBe('/repo');
    expect(workingFolder('/repo', 'apps/web')).toBe('/repo/apps/web');
    expect(workingFolder('/repo', '../other')).toBeNull();
    expect(workingFolder('/repo', '/etc')).toBeNull();
  });

  it('keeps the end of the output, on a line break', () => {
    const output = Array.from({ length: 50 }, (_, index) => `line ${index}`).join('\r\n');
    const tail = logTail(output, 40);
    expect(tail.endsWith('line 49')).toBe(true);
    expect(tail.startsWith('line ')).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(40);
    expect(lastLines('a\n\nb\nc\n', 2)).toBe('b\nc');
  });
});
