import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  pgCtlLogFile,
  pgCtlStartArgs,
  startWithPgCtl,
  stopLeftoverWithPgCtl,
  type CommandRunner,
} from './postgres-windows.ts';

let dataDir: string;
let calls: string[][];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'pg-ctl-'));
  calls = [];
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function runner(failing: string[] = []): CommandRunner {
  return (file, args) => {
    calls.push([file, ...args]);
    return failing.includes(args[0] ?? '')
      ? Promise.reject(new Error(`${args[0]} failed`))
      : Promise.resolve();
  };
}

function options(run: CommandRunner, lines: string[] = []) {
  return {
    pgCtl: 'pg_ctl',
    dataDir,
    port: 54321,
    host: '127.0.0.1',
    log: (line: string) => lines.push(line),
    run,
  };
}

describe('pg_ctl on Windows', () => {
  it('starts on loopback and the given port, waits, and logs to the data folder', () => {
    expect(pgCtlStartArgs(dataDir, 54321, '127.0.0.1')).toEqual([
      'start',
      '-D',
      dataDir,
      '-w',
      '-t',
      '60',
      '-l',
      pgCtlLogFile(dataDir),
      '-o',
      '-p 54321 -c listen_addresses=127.0.0.1',
    ]);
  });

  it('returns a stop that shuts the server down fast', async () => {
    const stop = await startWithPgCtl(options(runner()));
    await stop();
    expect(calls.map((call) => call[1])).toEqual(['start', 'stop']);
    expect(calls[1]).toEqual(['pg_ctl', 'stop', '-D', dataDir, '-m', 'fast', '-w']);
  });

  it('puts the end of the server log in the error when it does not start', async () => {
    await writeFile(pgCtlLogFile(dataDir), 'one\nFATAL: could not bind to port\n');
    const lines: string[] = [];
    await expect(startWithPgCtl(options(runner(['start']), lines))).rejects.toThrow(
      'pg_ctl could not start Postgres: one\nFATAL: could not bind to port',
    );
    expect(lines).toEqual(['one\nFATAL: could not bind to port']);
  });

  it('stops a server left running only when pg_ctl reports one', async () => {
    await stopLeftoverWithPgCtl(options(runner(['status'])));
    expect(calls.map((call) => call[1])).toEqual(['status']);
    calls = [];
    const lines: string[] = [];
    await stopLeftoverWithPgCtl(options(runner(), lines));
    expect(calls.map((call) => call[1])).toEqual(['status', 'stop']);
    expect(lines).toEqual(['Stopping Postgres left running by an earlier launch.']);
  });
});
