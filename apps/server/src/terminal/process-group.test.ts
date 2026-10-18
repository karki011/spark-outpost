import { describe, expect, it } from 'vitest';
import { commandLabel, descendantsOf, runningCommand, type ProcessRow } from './process-group.ts';

function row(pid: number, ppid: number, args: string, foregroundGroup = 0): ProcessRow {
  return { pid, ppid, foregroundGroup, args };
}

describe('descendantsOf', () => {
  it('finds children and grandchildren but not unrelated processes', () => {
    const table = [row(10, 1, 'a'), row(11, 10, 'b'), row(12, 11, 'c'), row(13, 10, 'd')];
    expect(descendantsOf(10, [...table, row(20, 1, 'e')]).sort()).toEqual([11, 12, 13]);
  });
});

describe('runningCommand', () => {
  it('is null for a shell waiting at its prompt', () => {
    const table = [row(10, 1, '-zsh', 10), row(20, 1, 'sleep 100')];
    expect(runningCommand(10, table)).toBeNull();
  });

  it('names the foreground job rather than what it started', () => {
    const table = [
      row(10, 1, '-zsh', 31),
      row(30, 10, 'sleep 5'),
      row(31, 10, 'node /Users/me/.local/share/node24/bin/pnpm dev'),
      row(32, 31, 'node /repo/node_modules/.bin/vite'),
    ];
    expect(runningCommand(10, table)).toBe('pnpm dev');
  });

  it('is null while the shell only has a process mid-exec or a finished child', () => {
    const table = [
      row(10, 1, '-bash', 50),
      row(50, 10, '(bash)'),
      row(51, 10, '<defunct>'),
      row(52, 10, '[python3] <defunct>'),
    ];
    expect(runningCommand(10, table)).toBeNull();
  });

  it('falls back to a direct child when nothing is in the foreground', () => {
    const table = [row(10, 1, '-zsh', 10), row(40, 10, '/bin/sleep 100'), row(41, 40, 'x')];
    expect(runningCommand(10, table)).toBe('sleep 100');
  });
});

describe('commandLabel', () => {
  it('shows scripts by name instead of their interpreter', () => {
    expect(commandLabel('/usr/local/bin/python3.12 /opt/tools/serve.py --port 8000')).toBe(
      'serve --port 8000',
    );
    expect(commandLabel('node server.js')).toBe('node server.js');
    expect(commandLabel('/usr/bin/make watch')).toBe('make watch');
  });

  it('shortens very long command lines', () => {
    const label = commandLabel(`tail -f ${'x'.repeat(200)}`);
    expect(label).toHaveLength(60);
    expect(label.endsWith('…')).toBe(true);
  });
});
