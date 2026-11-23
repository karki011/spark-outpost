import { describe, expect, it } from 'vitest';
import { msysPs, withMsysParents } from './msys-processes.ts';
import { descendantsOf } from './process-group.ts';

const MSYS = [
  '      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND',
  '     1232       1    1232       1232  pty0      197609 13:01:02 /usr/bin/bash',
  'S    1016    1232    1016       8124  pty0      197609 13:01:05 /usr/bin/sleep',
  '',
].join('\n');

const rows = [
  { pid: 5664, ppid: 3184, args: '"C:\\Program Files\\Git\\bin\\bash.exe" -l' },
  { pid: 1232, ppid: 5664, args: '"C:\\Program Files\\Git\\bin\\..\\usr\\bin\\bash.exe" -l' },
  { pid: 8124, ppid: 1016, args: '"C:\\Program Files\\Git\\usr\\bin\\sleep.exe" 100' },
];

describe("Git Bash's own process tree", () => {
  it('links a command to the shell that started it when its Windows parent is gone', () => {
    expect(descendantsOf(5664, rows)).toEqual([1232]);
    expect(descendantsOf(5664, withMsysParents(rows, MSYS))).toEqual([1232, 8124]);
  });

  it('leaves the table alone without Git Bash', () => {
    expect(withMsysParents(rows, null)).toEqual(rows);
  });

  it("finds Git's ps beside its bash", () => {
    expect(msysPs('C:\\Program Files\\Git\\bin\\bash.exe')).toBe(
      'C:\\Program Files\\Git\\usr\\bin\\ps.exe',
    );
  });
});
