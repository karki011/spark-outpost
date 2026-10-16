import { describe, expect, it } from 'vitest';
import { decideSlot, parseProcessTable, type ProcessRow } from './slot-processes.ts';

const ROOT = '/Users/dev/spark-outpost';
const WORKTREE = '/Users/dev/spark-outpost/.claude/worktrees/other';
const NODE = '/opt/homebrew/bin/node';
const PLAYWRIGHT = `${NODE} ${ROOT}/node_modules/@playwright/test/cli.js test --shard=1/6`;

const rows: ProcessRow[] = [
  { pid: 100, ppid: 1, pgid: 100, command: PLAYWRIGHT },
  {
    pid: 110,
    ppid: 100,
    pgid: 110,
    command: `${NODE} --import tsx tests/browser/provider-stub.ts`,
  },
  { pid: 200, ppid: 1, pgid: 200, command: `${NODE} --import tsx tests/browser/provider-stub.ts` },
  { pid: 300, ppid: 1, pgid: 300, command: '/bin/sh -c while :; do node src/api/main.ts; done' },
  { pid: 301, ppid: 300, pgid: 300, command: `${NODE} --import tsx src/api/main.ts` },
  { pid: 400, ppid: 1, pgid: 400, command: `${NODE} node_modules/vite/bin/vite.js preview` },
  { pid: 500, ppid: 1, pgid: 500, command: '/usr/local/bin/python3 -m http.server 20912' },
  { pid: 600, ppid: 1, pgid: 600, command: `${NODE} --import tsx src/workflow/main.ts` },
];

describe('decideSlot', () => {
  it('stops orphaned stub, api, web and worker processes started from this checkout', () => {
    const decision = decideSlot(
      [
        { pid: 200, port: 20910, cwd: ROOT },
        { pid: 301, port: 20911, cwd: `${ROOT}/apps/server` },
        { pid: 400, port: 20912, cwd: `${ROOT}/apps/web` },
        { pid: 600, port: null, cwd: `${ROOT}/apps/server` },
      ],
      rows,
      ROOT,
    );
    expect(decision.blocked).toEqual([]);
    expect(decision.stop.map((verdict) => verdict.pgid)).toEqual([200, 300, 400, 600]);
  });

  it('leaves a server alone while a Playwright run from this checkout still owns it', () => {
    const decision = decideSlot([{ pid: 110, port: 20910, cwd: ROOT }], rows, ROOT);
    expect(decision.stop).toEqual([]);
    expect(decision.blocked.map((verdict) => verdict.kind)).toEqual(['running']);
  });

  it('never claims a test server from another worktree, even one nested under this checkout', () => {
    const decision = decideSlot(
      [
        { pid: 200, port: 20910, cwd: WORKTREE },
        { pid: 301, port: 20911, cwd: `${WORKTREE}/apps/server` },
      ],
      rows,
      ROOT,
    );
    expect(decision.stop).toEqual([]);
    expect(decision.blocked.map((verdict) => verdict.kind)).toEqual(['foreign', 'foreign']);
  });

  it('treats something that is not a Spark test server as foreign, even in this checkout', () => {
    const decision = decideSlot([{ pid: 500, port: 20912, cwd: `${ROOT}/apps/web` }], rows, ROOT);
    expect(decision.blocked.map((verdict) => verdict.kind)).toEqual(['foreign']);
  });

  it('treats a process whose folder could not be read, or that has exited, as foreign', () => {
    const decision = decideSlot(
      [
        { pid: 200, port: 20910, cwd: null },
        { pid: 999, port: 20911, cwd: ROOT },
      ],
      rows,
      ROOT,
    );
    expect(decision.stop).toEqual([]);
    expect(decision.blocked.map((verdict) => verdict.command)).toEqual([
      rows[2]!.command,
      '(gone)',
    ]);
  });

  it('frees a slot with nothing on it', () => {
    expect(decideSlot([], rows, ROOT)).toEqual({ stop: [], blocked: [] });
  });
});

describe('parseProcessTable', () => {
  it('reads pid, parent, group and the full command from ps output', () => {
    expect(
      parseProcessTable('  301   300   300 /opt/node --import tsx src/api/main.ts\n\nnoise\n'),
    ).toEqual([
      { pid: 301, ppid: 300, pgid: 300, command: '/opt/node --import tsx src/api/main.ts' },
    ]);
  });
});
