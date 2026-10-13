import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyOptions, PtyProcess } from '../pty.ts';
import { chooseTmux, tmuxArgs, tmuxBaseEnv, tmuxConfigText } from './tmux-host.ts';
import { tmuxSpawner } from './tmux-spawner.ts';

let folder: string;

function script(name: string, body: string): string {
  const file = join(folder, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

beforeEach(() => {
  folder = mkdtempSync(join(os.tmpdir(), 'sptx-host-'));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('choosing tmux for Terminal sessions', () => {
  it('uses a binary that passes its version check, on a socket and config in the data folder', () => {
    const bin = script('tmux', 'echo "tmux 3.8"');
    const choice = chooseTmux(
      { SPARK_TMUX_BIN: bin, HOME: '/Users/me' },
      join(folder, 'dev'),
      null,
    );
    expect(choice.reason).toBeNull();
    expect(choice.host).toMatchObject({
      bin,
      socket: join(folder, 'dev', 's'),
      configPath: join(folder, 'dev', 'tmux.conf'),
    });
    expect(tmuxArgs(choice.host!, ['ls'])).toEqual([
      '-u',
      '-S',
      join(folder, 'dev', 's'),
      '-f',
      join(folder, 'dev', 'tmux.conf'),
      'ls',
    ]);
  });

  it('keeps one socket per data folder so channels never share sessions', () => {
    const bin = script('tmux', 'echo "tmux 3.8"');
    const dev = chooseTmux({ SPARK_TMUX_BIN: bin }, join(folder, 'spark-dev', 'tmux'), null);
    const beta = chooseTmux({ SPARK_TMUX_BIN: bin }, join(folder, 'spark-beta', 'tmux'), null);
    expect(dev.host!.socket).not.toBe(beta.host!.socket);
  });

  it('falls back with a reason when there is no binary, it fails, or it is turned off', () => {
    expect(chooseTmux({}, folder, null).reason).toBe('no tmux binary is bundled or built');
    expect(chooseTmux({}, folder, folder).reason).toBe('no tmux binary is bundled or built');
    const broken = script('broken', 'exit 3');
    expect(chooseTmux({ SPARK_TMUX_BIN: broken }, folder, null).reason).toContain(
      'failed its check',
    );
    const other = script('other', 'echo "screen 4"');
    expect(chooseTmux({ SPARK_TMUX_BIN: other }, folder, null).reason).toContain('something else');
    const bin = script('tmux', 'echo "tmux 3.8"');
    expect(
      chooseTmux({ SPARK_TMUX_BIN: bin, SPARK_TERMINAL_TMUX: 'off' }, folder, null).host,
    ).toBeNull();
  });

  it('falls back when the socket path would be too long', () => {
    const bin = script('tmux', 'echo "tmux 3.8"');
    const deep = join(folder, 'x'.repeat(110));
    expect(chooseTmux({ SPARK_TMUX_BIN: bin }, deep, null).reason).toContain('too long');
  });

  it('gives the tmux server a small fixed environment with no secrets from Spark', () => {
    const env = tmuxBaseEnv({
      HOME: '/Users/me',
      USER: 'me',
      SPARK_API_TOKEN: 'secret',
      PATH: '/x',
    });
    expect(env).toMatchObject({
      HOME: '/Users/me',
      USER: 'me',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    });
    expect(Object.keys(env)).not.toContain('SPARK_API_TOKEN');
  });

  it('writes a config with no status line, prefix or mouse, and keeps a dead pane for its status', () => {
    const config = tmuxConfigText();
    for (const line of [
      'set -g status off',
      'set -g mouse off',
      'set -g prefix None',
      'set -s escape-time 0',
      'set -g focus-events on',
      'set -s extended-keys on',
      'set -g history-limit 50000',
      'set -g window-size latest',
      'set -g remain-on-exit on',
      'set -g allow-rename off',
    ])
      expect(config).toContain(`${line}\n`);
  });
});

describe('tmux spawner', () => {
  const direct = { pid: 1 } as PtyProcess;
  const host = {
    bin: '/tmux',
    directory: '/d',
    socket: '/d/s',
    configPath: '/d/tmux.conf',
    env: { HOME: '/Users/me' },
  };
  const agent: PtyOptions = { cols: 80, rows: 24, command: '/bin/claude', sessionId: 'a' };

  it('runs shells and every session directly when tmux is not available', () => {
    const base = vi.fn(() => direct);
    expect(tmuxSpawner(base, null)(agent)).toBe(direct);
    const control = vi.fn();
    const spawn = tmuxSpawner(base, host, vi.fn(), control);
    expect(spawn({ cols: 80, rows: 24 })).toBe(direct);
    expect(spawn({ cols: 80, rows: 24, command: '/bin/sh' })).toBe(direct);
    expect(control).not.toHaveBeenCalled();
  });

  it('runs an agent session under tmux with its whole environment passed explicitly', () => {
    const viaTmux = { pid: 2 } as PtyProcess;
    const control = vi.fn(() => viaTmux);
    const spawn = tmuxSpawner(vi.fn(), host, vi.fn(), control);
    expect(spawn({ ...agent, cwd: '/work', args: ['-x'], env: { EXTRA: '1' } })).toBe(viaTmux);
    expect(control).toHaveBeenCalledWith(
      host,
      expect.objectContaining({
        sessionId: 'a',
        adopt: false,
        cwd: '/work',
        command: '/bin/claude',
        args: ['-x'],
        env: expect.objectContaining({ EXTRA: '1', TERM: 'xterm-256color' }) as unknown,
      }),
    );
  });

  it('starts the session directly and says so once when tmux refuses', () => {
    const base = vi.fn(() => direct);
    const log = vi.fn();
    const control = vi.fn(() => {
      throw new Error('server exited');
    });
    const spawn = tmuxSpawner(base, host, log, control);
    expect(spawn(agent)).toBe(direct);
    expect(spawn(agent)).toBe(direct);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Terminal sessions run without tmux: server exited',
    );
  });

  it('never starts a fresh process in place of a session it was asked to adopt', () => {
    const base = vi.fn(() => direct);
    const control = vi.fn(() => {
      throw new Error('That terminal session is no longer running.');
    });
    expect(() => tmuxSpawner(base, host, vi.fn(), control)({ ...agent, adopt: true })).toThrow(
      'no longer running',
    );
    expect(base).not.toHaveBeenCalled();
  });
});
