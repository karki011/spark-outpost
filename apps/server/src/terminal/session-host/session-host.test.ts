import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { childEnvironment } from '../../setup/environment.ts';
import { descendantsOf, isAlive, processTable } from '../process-group.ts';
import type { PtyOptions, PtyProcess, SpawnPty } from '../pty.ts';
import { HOST_ENTRY, type NodeLauncher } from './host-launch.ts';
import { hostKept } from './host-kept.ts';
import { sessionHostPaths, type SessionHostPaths } from './paths.ts';

type Exit = { exitCode: number; signal?: number | undefined };

interface Running {
  pty: PtyProcess;
  output: () => string;
  exit: Promise<Exit>;
}

const ECHO = [
  "process.stdout.write('ready:' + process.env.SPARK_TEST_VALUE + '\\n');",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (d) => { for (const line of d.split(/\\r?\\n|\\r/)) {",
  "  if (line === 'quit') process.exit(3);",
  "  if (line) process.stdout.write('got:' + line + '\\n'); } });",
].join(' ');

const LATER_EXIT = "setTimeout(() => process.exit(4), 300); process.stdout.write('leaving\\n');";

const CHILD_TREE = [
  "const { spawn } = require('node:child_process');",
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
  "process.stdout.write('child:' + child.pid + '\\n');",
  'setInterval(() => {}, 1000);',
].join(' ');

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

const refusedBase: SpawnPty = () => {
  throw new Error('The direct PTY was used.');
};

describe('the Spark session host with a real PTY', { timeout: 60_000 }, () => {
  let folder: string;
  let paths: SessionHostPaths;
  let launcher: NodeLauncher;

  const kept = () => hostKept({ paths, launcher }, () => undefined);

  const start = (spawn: SpawnPty, script: string, extra: Partial<PtyOptions> = {}): Running => {
    const pty = spawn({
      sessionId: 's1',
      command: process.execPath,
      args: ['-e', script],
      cols: 80,
      rows: 24,
      cwd: folder,
      env: { SPARK_TEST_VALUE: "it's here" },
      ...extra,
    });
    let output = '';
    pty.onData((data) => {
      output += data;
    });
    const exit = new Promise<Exit>((done) => pty.onExit(done));
    return { pty, output: () => output, exit };
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'sh-'));
    paths = sessionHostPaths(join(folder, 'host'));
    launcher = {
      file: process.execPath,
      args: ['--import', 'tsx', HOST_ENTRY],
      env: childEnvironment(process.env),
    };
  });

  afterEach(async () => {
    await kept().stopAll();
    rmSync(folder, { recursive: true, force: true });
  });

  it('starts a session, streams it, and finds it again from a new client after the first one goes', async () => {
    const first = start(kept().spawner(refusedBase), ECHO);
    await until(() => first.output().includes("ready:it's here"), 'the session to start');
    first.pty.write('hello\r');
    await until(() => first.output().includes('got:hello'), 'the echo');
    first.pty.resize(100, 30);
    expect(await first.pty.screen?.()).toContain('got:hello');
    first.pty.detach?.();

    const table = await processTable();
    const host = table.find(
      (row) => row.args.includes('serve') && row.args.includes(paths.directory),
    );
    expect(host).toBeDefined();
    expect(descendantsOf(process.pid, table)).not.toContain(host!.pid);

    const again = kept();
    expect(await again.listSessionIds()).toEqual(['s1']);
    const adopted = start(again.spawner(refusedBase), ECHO, { adopt: true });
    expect(adopted.pty.pid).toBe(first.pty.pid);
    await until(() => adopted.output().includes('got:hello'), 'the replay');
    adopted.pty.write('again\r');
    await until(() => adopted.output().includes('got:again'), 'the echo after adopting');
    adopted.pty.write('quit\r');
    expect(await adopted.exit).toEqual({ exitCode: 3 });
    expect(await again.listSessionIds()).toEqual([]);
  });

  it('records the exit status of a session that ended while no client was attached', async () => {
    const first = start(kept().spawner(refusedBase), LATER_EXIT);
    await until(() => first.output().includes('leaving'), 'the session to start');
    first.pty.detach?.();
    const again = kept();
    await until(async () => {
      await again.listSessionIds();
      return !isAlive(first.pty.pid);
    }, 'the command to end');
    expect(await again.listSessionIds()).toEqual(['s1']);
    const adopted = start(again.spawner(refusedBase), LATER_EXIT, { adopt: true });
    expect(await adopted.exit).toEqual({ exitCode: 4 });
    expect(await again.listSessionIds()).toEqual([]);
  });

  it('stops the whole process tree of a session', async () => {
    const running = start(kept().spawner(refusedBase), CHILD_TREE);
    await until(() => /child:\d+/.test(running.output()), 'the child process');
    const child = Number(/child:(\d+)/.exec(running.output())![1]);
    running.pty.kill?.();
    expect(await running.exit).toEqual({ exitCode: 0, signal: 1 });
    await until(() => !isAlive(child) && !isAlive(running.pty.pid), 'the tree to stop');
    expect(await kept().listSessionIds()).toEqual([]);
  });

  it('refuses to adopt a session the host does not have and falls back for a new one it cannot start', async () => {
    const sessions = kept();
    expect(await sessions.listSessionIds()).toEqual([]);
    expect(() => start(sessions.spawner(refusedBase), ECHO, { adopt: true })).toThrow(
      'That terminal session is no longer running.',
    );
    const direct = { pid: 1 } as PtyProcess;
    const broken = hostKept(
      { paths, launcher: { ...launcher, args: ['-e', 'process.exit(1)'] } },
      () => undefined,
    );
    expect(
      broken.spawner(() => direct)({ sessionId: 's2', command: 'x', cols: 80, rows: 24 }),
    ).toBe(direct);
  });

  it('stops every session and exits when Spark quits', async () => {
    const running = start(kept().spawner(refusedBase), ECHO);
    await until(() => running.output().includes('ready:'), 'the session to start');
    await kept().stopAll();
    await until(() => !isAlive(running.pty.pid), 'the session to stop');
    expect(await kept().listSessionIds()).toEqual([]);
  });
});
