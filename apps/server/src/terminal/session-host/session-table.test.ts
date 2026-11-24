import { describe, expect, it, vi } from 'vitest';
import type { CreateRequest } from './protocol.ts';
import type { ScreenModel } from './screen.ts';
import { SessionTable, type HostPty } from './session-table.ts';

interface FakePty extends HostPty {
  print(data: string): void;
  end(exitCode: number, signal?: number): void;
  written: string[];
}

function fakePty(pid: number): FakePty {
  const data: ((text: string) => void)[] = [];
  const exits: ((exit: { exitCode: number; signal?: number | undefined }) => void)[] = [];
  return {
    pid,
    written: [],
    write(text) {
      this.written.push(text);
    },
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (listener) => data.push(listener),
    onExit: (listener) => exits.push(listener),
    print: (text) => data.forEach((listener) => listener(text)),
    end: (exitCode, signal) => exits.forEach((listener) => listener({ exitCode, signal })),
  };
}

const screen = (): ScreenModel => {
  let shown = '';
  return {
    write: (text) => {
      shown += text;
    },
    resize: vi.fn(),
    text: async () => shown,
    dispose: vi.fn(),
  };
};

const create = (session: string): CreateRequest => ({
  kind: 'create',
  session,
  cols: 80,
  rows: 24,
  cwd: '/work',
  command: 'claude',
  args: [],
  env: { SECRET_TOKEN: 'abc' },
});

function setup() {
  const ptys: FakePty[] = [];
  const deps = {
    spawn: vi.fn(() => {
      const pty = fakePty(100 + ptys.length);
      ptys.push(pty);
      return pty;
    }),
    screen,
    killTree: vi.fn<(pid: number) => Promise<void>>(async () => undefined),
    output: vi.fn(),
    exited: vi.fn(),
  };
  return { table: new SessionTable(deps), deps, ptys };
}

describe('the session table', () => {
  it('starts a session, keeps its output for replay and forwards it', async () => {
    const { table, deps, ptys } = setup();
    expect(table.create(create('a'))).toBe(100);
    ptys[0]!.print('hello');
    expect(deps.output).toHaveBeenCalledWith('a', 'hello');
    expect(table.attach('a')).toEqual({ pid: 100, replay: 'hello', exit: null });
    expect(await table.screen('a')).toBe('hello');
    expect(await table.screen('missing')).toBeNull();
    table.write('a', 'x');
    table.resize('a', 120, 40);
    expect(ptys[0]!.written).toEqual(['x']);
    expect(ptys[0]!.resize).toHaveBeenCalledWith(120, 40);
    expect(table.list()).toEqual([{ session: 'a', pid: 100, exited: false }]);
    expect(JSON.stringify(table.list())).not.toContain('abc');
  });

  it('refuses a second session with the same id while the first runs', () => {
    const { table } = setup();
    table.create(create('a'));
    expect(() => table.create(create('a'))).toThrow('already running');
  });

  it('keeps an ended session with its status until it is removed', () => {
    const { table, deps, ptys } = setup();
    table.create(create('a'));
    ptys[0]!.end(143, 15);
    expect(deps.exited).toHaveBeenCalledWith('a', { exitCode: 143, signal: 15 });
    expect(table.list()).toEqual([{ session: 'a', pid: 100, exited: true }]);
    expect(table.attach('a').exit).toEqual({ exitCode: 143, signal: 15 });
    table.write('a', 'ignored');
    expect(ptys[0]!.written).toEqual([]);
    table.remove('a');
    expect(table.size).toBe(0);
    expect(() => table.attach('a')).toThrow('no longer running');
  });

  it('does not remove a running session on a remove request', () => {
    const { table } = setup();
    table.create(create('a'));
    table.remove('a');
    expect(table.size).toBe(1);
  });

  it('stops a session by its process tree, then the PTY, and ignores its late events', async () => {
    const { table, deps, ptys } = setup();
    table.create(create('a'));
    await table.kill('a');
    expect(deps.killTree).toHaveBeenCalledWith(100);
    expect(ptys[0]!.kill).toHaveBeenCalled();
    ptys[0]!.print('late');
    ptys[0]!.end(1);
    expect(deps.output).not.toHaveBeenCalled();
    expect(deps.exited).not.toHaveBeenCalled();
    expect(table.size).toBe(0);
  });

  it('starts a session again in place of one that ended and stops them all', async () => {
    const { table, deps, ptys } = setup();
    table.create(create('a'));
    ptys[0]!.end(0);
    expect(table.create(create('a'))).toBe(101);
    table.create(create('b'));
    await table.killAll();
    expect(deps.killTree.mock.calls.map(([pid]) => pid).sort()).toEqual([101, 102]);
    expect(table.size).toBe(0);
  });
});
