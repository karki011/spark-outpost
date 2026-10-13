import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAlive } from '../process-group.ts';
import type { PtyProcess } from '../pty.ts';
import { controlPty, type ControlPtyStart } from './control-pty.ts';
import { chooseTmux, killTmuxServer, tryTmux, type TmuxHost } from './tmux-host.ts';
import { killUnknownSessions, listSessionIds, readPane } from './tmux-session.ts';

const built = resolve(
  import.meta.dirname,
  '../../../../..',
  '.local/tmux',
  process.arch,
  'bin/tmux',
);
const bin = process.env.SPARK_TMUX_BIN || (existsSync(built) ? built : null);

interface Running {
  pty: PtyProcess;
  output: () => string;
  exit: Promise<{ exitCode: number; signal?: number | undefined }>;
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

describe.skipIf(!bin)('Terminal sessions under a real tmux', () => {
  let directory: string;
  let host: TmuxHost;

  const start = (script: string, extra: Partial<ControlPtyStart> = {}): Running => {
    const pty = controlPty(host, {
      sessionId: 'a1',
      adopt: false,
      cols: 80,
      rows: 24,
      cwd: directory,
      command: '/bin/sh',
      args: ['-c', script],
      env: { SPARK_TEST_VALUE: "it's here" },
      ...extra,
    });
    let output = '';
    pty.onData((data) => {
      output += data;
    });
    const exit = new Promise<{ exitCode: number; signal?: number | undefined }>((done) =>
      pty.onExit(done),
    );
    return { pty, output: () => output, exit };
  };

  beforeEach(() => {
    directory = mkdtempSync(join(os.tmpdir(), 'sptx-'));
    const choice = chooseTmux({ ...process.env, SPARK_TMUX_BIN: bin! }, directory, null);
    if (!choice.host) throw new Error(choice.reason);
    host = choice.host;
  });

  afterEach(() => {
    killTmuxServer(host);
    rmSync(directory, { recursive: true, force: true });
  });

  it('runs the command with its environment, folder and no trace of tmux', async () => {
    const run = start('pwd; echo "v=$SPARK_TEST_VALUE t=${TMUX:-none} term=$TERM"; exit 0');
    expect(await run.exit).toEqual({ exitCode: 0 });
    expect(run.output()).toContain(`v=it's here t=none term=xterm-256color`);
    expect(run.output()).toContain(directory.split('/').at(-1));
    expect(listSessionIds(host)).toEqual([]);
  });

  it('passes typed bytes, a resize and UTF-8 output through unchanged', async () => {
    const run = start(
      'stty size; IFS= read -r line; printf "got:%s é✓\\033[31m!\\n" "$line"; sleep 30',
    );
    await until(() => run.output().includes('24 80'), 'the first size');
    run.pty.resize(100, 30);
    await until(() => readPane(host, 'a1')?.cols === 100, 'the resize');
    run.pty.write('héllo\r');
    await until(() => run.output().includes('got:héllo é✓\x1b[31m!'), 'the echo');
    run.pty.kill?.();
    expect(await run.exit).toEqual({ exitCode: 0, signal: 1 });
  });

  it('reports the real exit status', async () => {
    expect(await start('exit 7').exit).toEqual({ exitCode: 7 });
  });

  it('kills the whole process tree and the session on stop', async () => {
    const run = start('sleep 300 & echo "child=$!"; wait');
    await until(() => /child=\d+/.test(run.output()), 'the child');
    const child = Number(/child=(\d+)/.exec(run.output())![1]);
    run.pty.kill?.();
    await run.exit;
    await until(() => !isAlive(child) && !isAlive(run.pty.pid), 'the tree to stop');
    expect(listSessionIds(host)).toEqual([]);
  });

  it('keeps running when detached and shows the same screen when adopted', async () => {
    const first = start(
      'printf "one\\n\\033]8;;https://example.com/x\\033\\\\link\\033]8;;\\033\\\\\\n\\033[?2004h\\033[?1000h"; while IFS= read -r l; do echo "again:$l"; done',
    );
    await until(() => first.output().includes('link'), 'the first screen');
    first.pty.detach?.();
    expect(readPane(host, 'a1')?.dead).toBe(false);
    const again = start('unused', { adopt: true });
    await until(() => again.output().includes('one'), 'the seed');
    expect(again.pty.pid).toBe(first.pty.pid);
    expect(again.output()).toContain('\x1b]8;;https://example.com/x\x1b\\link');
    expect(again.output()).toContain('\x1b[?2004h');
    expect(again.output()).toContain('\x1b[?1000h');
    again.pty.write('more\r');
    await until(() => again.output().includes('again:more'), 'output after adoption');
    again.pty.kill?.();
    await again.exit;
  });

  it('reports the exit status of a command that ended while detached', async () => {
    const first = start('IFS= read -r l; exit 5');
    await until(() => readPane(host, 'a1') !== null, 'the session');
    first.pty.write('\r');
    first.pty.detach?.();
    await until(() => readPane(host, 'a1')?.dead === true, 'the command to end');
    expect(await start('unused', { adopt: true }).exit).toEqual({ exitCode: 5 });
    expect(listSessionIds(host)).toEqual([]);
  });

  it('refuses to adopt a session that is gone', () => {
    expect(() => start('unused', { adopt: true })).toThrow('no longer running');
  });

  it('ends the session when the tmux server dies', async () => {
    const run = start('sleep 300');
    await until(() => readPane(host, 'a1') !== null, 'the session');
    killTmuxServer(host);
    expect(await run.exit).toEqual({ exitCode: 1 });
  });

  it('carries a large burst and a large argument intact', async () => {
    const big = 'x'.repeat(120_000);
    const run = start('unused', {
      args: ['-c', 'printf "len=%s\\n" "${#1}"; seq 1 20000; echo finished', 'sh', big],
    });
    await until(() => run.output().includes('finished'), 'the burst');
    expect(run.output()).toContain('len=120000');
    expect(run.output()).toContain('\r\n19999\r\n20000\r\n');
    run.pty.kill?.();
    await run.exit;
  });

  it('removes sessions that are not Spark terminals', () => {
    tryTmux(host, ['new-session', '-d', '-s', 'stray', '--', '/bin/sleep', '300']);
    killUnknownSessions(host);
    expect(tryTmux(host, ['list-sessions', '-F', '#{session_name}'])).toBeNull();
  });
});
