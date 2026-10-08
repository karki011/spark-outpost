import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PtyOptions, PtyProcess } from './pty.ts';
import { defaultLimits, TerminalAuthError, TerminalSessions } from './sessions.ts';

function fixture() {
  let output: (data: string) => void = () => undefined;
  let exit: (event: { exitCode: number }) => void = () => undefined;
  const pty: PtyProcess = {
    pid: 999_999_999,
    write: vi.fn(),
    resize: vi.fn(),
    onData: (listener) => {
      output = listener;
    },
    onExit: (listener) => {
      exit = listener;
    },
  };
  const spawn = vi.fn((_options: PtyOptions) => pty);
  const sessions = new TerminalSessions(spawn, { ...defaultLimits, tokenTtlMs: 30 });
  const request = {
    id: 'native-agent',
    cwd: '/tmp',
    conversationId: 'chat-a',
    label: 'Claude',
    command: '/bin/claude',
    args: ['--settings', '/tmp/settings.json'],
    env: { SPARK_SESSION_ID: 'native-agent' },
  };
  const client = () => ({ output: vi.fn(), send: vi.fn(), close: vi.fn() });
  return {
    sessions,
    spawn,
    request,
    client,
    pty,
    output: (data: string) => output(data),
    exit: (exitCode: number) => exit({ exitCode }),
  };
}

const opened: TerminalSessions[] = [];
afterEach(() => {
  for (const sessions of opened.splice(0)) sessions.killAll();
});
function useFixture() {
  const f = fixture();
  opened.push(f.sessions);
  return f;
}

describe('native terminal ownership', () => {
  it('starts one direct executable before a view connects and ignores token expiry for process lifetime', async () => {
    const f = useFixture();
    f.sessions.createAgent(f.request);
    expect(f.spawn).toHaveBeenCalledExactlyOnceWith({
      cols: 100,
      rows: 30,
      cwd: '/tmp',
      command: '/bin/claude',
      args: f.request.args,
      env: f.request.env,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(f.sessions.activeCount).toBe(1);
    const attached = f.sessions.reattach(f.request.id)!;
    f.sessions.attach(attached.id, attached.token, f.client(), { cols: 80, rows: 24 });
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });

  it('reattaches to the same process, replays bounded output and invalidates old tokens', () => {
    const f = useFixture();
    const first = f.sessions.createAgent(f.request);
    const original = f.client();
    const connection = f.sessions.attach(first.id, first.token, original, { cols: 80, rows: 24 });
    connection.disconnect();
    f.output('x'.repeat(300_000));
    f.output('finished');
    const fresh = f.sessions.reattach(first.id)!;
    expect(() =>
      f.sessions.attach(first.id, first.token, f.client(), { cols: 80, rows: 24 }),
    ).toThrow(TerminalAuthError);
    const next = f.client();
    const nextConnection = f.sessions.attach(fresh.id, fresh.token, next, { cols: 120, rows: 40 });
    expect(next.output).toHaveBeenCalledWith(expect.stringMatching(/finished$/));
    expect(next.output.mock.calls[0]![0].length).toBe(256_000);
    connection.disconnect();
    connection.input('stale input');
    connection.resize(10, 4);
    connection.close();
    expect(f.pty.write).not.toHaveBeenCalled();
    expect(f.sessions.activeCount).toBe(1);
    f.output('still-connected');
    expect(next.output).toHaveBeenLastCalledWith('still-connected');
    nextConnection.input('answer\r');
    expect(f.pty.write).toHaveBeenCalledWith('answer\r');
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });

  it('reuses a matching launch and refuses another conversation or command', () => {
    const f = useFixture();
    const first = f.sessions.createAgent(f.request);
    const again = f.sessions.createAgent(f.request);
    expect(again.id).toBe(first.id);
    expect(again.token).not.toBe(first.token);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(() => f.sessions.createAgent({ ...f.request, conversationId: 'other-chat' })).toThrow(
      TerminalAuthError,
    );
    expect(() => f.sessions.createAgent({ ...f.request, command: '/bin/other' })).toThrow(
      TerminalAuthError,
    );
  });

  it('reports exit and cannot reattach an ended process', () => {
    const f = useFixture();
    const onExit = vi.fn();
    const created = f.sessions.createAgent({ ...f.request, onExit });
    const client = f.client();
    f.sessions.attach(created.id, created.token, client, { cols: 80, rows: 24 });
    f.exit(7);
    expect(onExit).toHaveBeenCalledExactlyOnceWith({ exitCode: 7 });
    expect(client.send).toHaveBeenCalledWith({ type: 'ended', reason: 'exited', exitCode: 7 });
    expect(f.sessions.reattach(created.id)).toBeNull();
  });
});
