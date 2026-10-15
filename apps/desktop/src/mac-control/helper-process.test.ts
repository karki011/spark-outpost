import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { MacHelperError, startMacHelper } from './helper-process.ts';

interface FakeChild {
  child: ChildProcessWithoutNullStreams;
  written: string[];
  reply(line: unknown): void;
  killed: () => boolean;
}

function fakeChild(pid: number): FakeChild {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: string[] = [];
  let killed = false;
  stdin.on('data', (chunk: Buffer) => written.push(...chunk.toString('utf8').trim().split('\n')));
  const child = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    pid,
    kill: () => {
      killed = true;
      events.emit('exit', null);
      return true;
    },
  }) as unknown as ChildProcessWithoutNullStreams;
  return {
    child,
    written,
    reply: (line) => stdout.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`),
    killed: () => killed,
  };
}

function setup(silentMs = 30_000) {
  const children: FakeChild[] = [];
  let id = 0;
  const helper = startMacHelper({
    binary: '/helper',
    log: () => undefined,
    silentMs,
    newId: () => `r${(id += 1)}`,
    spawn: () => {
      const made = fakeChild(100 + children.length);
      children.push(made);
      return made.child;
    },
  });
  return { helper, children };
}

const status = {
  trusted: true,
  locked: false,
  secureInput: false,
  idleSeconds: 3,
  frontmostPid: 9,
};

describe('the Mac control helper process', () => {
  it('sends one JSON line per request and matches answers by id', async () => {
    const { helper, children } = setup();
    const first = helper.call({ op: 'status' });
    const second = helper.call({ op: 'prompt' });
    await vi.waitFor(() => expect(children[0]!.written).toHaveLength(2));
    expect(JSON.parse(children[0]!.written[0]!)).toEqual({ op: 'status', id: 'r1' });
    children[0]!.reply({ id: 'r2', ok: true, result: { trusted: false } });
    children[0]!.reply('not json');
    children[0]!.reply({ id: 'r1', ok: true, result: status });
    await expect(second).resolves.toEqual({ trusted: false });
    await expect(first).resolves.toEqual(status);
    expect(helper.pid).toBe(100);
  });

  it('rejects an answer that does not match the contract, and passes helper errors through', async () => {
    const { helper, children } = setup();
    const bad = helper.call({ op: 'status' });
    const refused = helper.call({ op: 'read', pid: 5 });
    children[0]!.reply({ id: 'r1', ok: true, result: { trusted: 'yes' } });
    children[0]!.reply({ id: 'r2', ok: false, code: 'not_trusted', message: 'No permission.' });
    await expect(bad).rejects.toMatchObject({ code: 'invalid' });
    await expect(refused).rejects.toMatchObject({ code: 'not_trusted' });
  });

  it('restarts a helper that goes silent, failing what it held', async () => {
    vi.useFakeTimers();
    try {
      const { helper, children } = setup(1_000);
      const held = helper.call({ op: 'apps' });
      const failed = expect(held).rejects.toBeInstanceOf(MacHelperError);
      await vi.advanceTimersByTimeAsync(1_001);
      await failed;
      expect(children[0]!.killed()).toBe(true);
      const next = helper.call({ op: 'status' });
      expect(children).toHaveLength(2);
      children[1]!.reply({ id: 'r2', ok: true, result: status });
      await expect(next).resolves.toEqual(status);
    } finally {
      vi.useRealTimers();
    }
  });

  it('kill stops the process and fails pending calls as stopped', async () => {
    const { helper, children } = setup();
    const pending = helper.call({ op: 'apps' });
    helper.kill();
    await expect(pending).rejects.toMatchObject({ code: 'stopped' });
    expect(children[0]!.killed()).toBe(true);
    expect(helper.pid).toBeNull();
  });

  it('a crash fails pending calls and the next call starts a new helper', async () => {
    const { helper, children } = setup();
    const pending = helper.call({ op: 'apps' });
    children[0]!.child.emit('exit', 1);
    await expect(pending).rejects.toMatchObject({ code: 'failed' });
    void helper.call({ op: 'status' }).catch(() => undefined);
    expect(children).toHaveLength(2);
  });

  it('an aborted call is cancelled without stopping the helper', async () => {
    const { helper, children } = setup();
    const controller = new AbortController();
    const pending = helper.call({ op: 'apps' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(children[0]!.killed()).toBe(false);
  });
});
