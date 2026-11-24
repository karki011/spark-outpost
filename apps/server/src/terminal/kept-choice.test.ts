import { describe, expect, it } from 'vitest';
import { chooseKeptSessions, usesSessionHost } from './kept-choice.ts';

const input = {
  tmuxDirectory: '/data/tmux',
  hostDirectory: '/data/terminal-sessions/host',
  localDir: null,
};

describe('choosing how Terminal sessions are kept', () => {
  it('uses the session host on Windows unless it is turned off', () => {
    expect(usesSessionHost({}, 'win32')).toBe(true);
    expect(usesSessionHost({ SPARK_TERMINAL_HOST: 'off' }, 'win32')).toBe(false);
    expect(usesSessionHost({}, 'darwin')).toBe(false);
    expect(usesSessionHost({ SPARK_TERMINAL_HOST: 'on' }, 'darwin')).toBe(true);
  });

  it('reports the session host on Windows and no session host when it is off', () => {
    const host = chooseKeptSessions({ ...input, env: {}, platform: 'win32' });
    expect(host.kept).not.toBeNull();
    expect(host.tmux).toBeNull();
    expect(host.line).toBe('Terminal sessions run under the Spark session host.');
    const off = chooseKeptSessions({
      ...input,
      env: { SPARK_TERMINAL_HOST: 'off' },
      platform: 'win32',
    });
    expect(off.kept).toBeNull();
    expect(off.line).toBe(
      'Terminal sessions run without the session host (it is turned off); they stop when Spark restarts.',
    );
  });

  it('keeps tmux off Windows', () => {
    const choice = chooseKeptSessions({
      ...input,
      env: { SPARK_TERMINAL_TMUX: 'off' },
      platform: 'darwin',
    });
    expect(choice.kept).toBeNull();
    expect(choice.line).toBe(
      'Terminal sessions run without tmux (it is turned off); they stop when Spark restarts.',
    );
  });

  it('falls back when the socket path is too long', () => {
    const choice = chooseKeptSessions({
      ...input,
      hostDirectory: `/${'x'.repeat(120)}`,
      env: { SPARK_TERMINAL_HOST: 'on' },
      platform: 'darwin',
    });
    expect(choice.kept).toBeNull();
    expect(choice.line).toContain('too long');
  });
});
