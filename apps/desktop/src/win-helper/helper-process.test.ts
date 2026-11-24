import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { startWinHelper, WinHelperError } from './helper-process.ts';
import { winHelperEnv } from './protocol.ts';

interface FakeHelper {
  child: ChildProcessWithoutNullStreams;
  requests: Record<string, unknown>[];
  say(line: unknown): void;
  hold: Set<string>;
  verifyOutcome: unknown;
}

function fakeHelper(): FakeHelper {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const say = (line: unknown) =>
    stdout.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
  const made: FakeHelper = {
    child: Object.assign(events, {
      stdin,
      stdout,
      stderr: new PassThrough(),
      kill: () => {
        events.emit('exit', null);
        return true;
      },
    }) as unknown as ChildProcessWithoutNullStreams,
    requests: [],
    say,
    hold: new Set(),
    verifyOutcome: 'verified',
  };
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').trim().split('\n')) {
      const request = JSON.parse(line) as { id: string; op: string };
      made.requests.push(request);
      if (made.hold.has(request.op)) continue;
      if (request.op === 'status') say({ id: request.id, ok: true, result: { protocol: 1 } });
      if (request.op === 'hello.available')
        say({ id: request.id, ok: true, result: { available: true } });
      if (request.op === 'hello.verify')
        say({ id: request.id, ok: true, result: { outcome: made.verifyOutcome } });
    }
  });
  return made;
}

function setup(quickMs = 30_000) {
  const helpers: FakeHelper[] = [];
  const logged: string[] = [];
  let next = 0;
  const helper = startWinHelper({
    binary: 'C:\\spark-win-helper.exe',
    log: (line) => logged.push(line),
    quickMs,
    newId: () => `r${(next += 1)}`,
    spawn: () => {
      const made = fakeHelper();
      helpers.push(made);
      return made.child;
    },
  });
  return { helper, helpers, logged };
}

describe('the Windows helper process', () => {
  it('starts when first asked and answers by id', async () => {
    const { helper, helpers } = setup();
    expect(helpers).toHaveLength(0);
    await expect(helper.call({ op: 'status' })).resolves.toEqual({ protocol: 1 });
    await expect(
      helper.call({ op: 'hello.verify', message: 'Unlock', window: '18446744073709551615' }),
    ).resolves.toEqual({ outcome: 'verified' });
    expect(helpers).toHaveLength(1);
    expect(helpers[0]!.requests).toEqual([
      { op: 'status', id: 'r1' },
      { op: 'hello.verify', message: 'Unlock', window: '18446744073709551615', id: 'r2' },
    ]);
  });

  it('rejects an outcome it does not know and a helper error with its code', async () => {
    const { helper, helpers } = setup();
    await helper.call({ op: 'status' });
    helpers[0]!.verifyOutcome = 'granted';
    await expect(
      helper.call({ op: 'hello.verify', message: 'Unlock', window: null }),
    ).rejects.toMatchObject({ code: 'invalid' });
    helpers[0]!.hold.add('hello.available');
    const asking = helper.call({ op: 'hello.available' });
    helpers[0]!.say({ id: 'r3', ok: false, code: 'failed', message: 'HRESULT 0x80070005' });
    await expect(asking).rejects.toMatchObject({ code: 'failed' });
  });

  it('ignores lines that are not JSON or not for anyone', async () => {
    const { helper, helpers, logged } = setup();
    await helper.call({ op: 'status' });
    helpers[0]!.say('not json');
    helpers[0]!.say({ id: 'nobody', ok: true, result: {} });
    helpers[0]!.say({ id: null, ok: false, code: 'invalid', message: 'bad line' });
    await expect(helper.call({ op: 'status' })).resolves.toEqual({ protocol: 1 });
    expect(logged).toContain('The Windows helper wrote a line that is not JSON.');
  });

  it('restarts a silent helper but lets a Windows Hello dialog wait', async () => {
    vi.useFakeTimers();
    try {
      const { helper, helpers } = setup(1_000);
      await helper.call({ op: 'status' });
      helpers[0]!.hold.add('hello.verify');
      helpers[0]!.hold.add('hello.available');
      const verifying = helper.call({ op: 'hello.verify', message: 'Unlock', window: null });
      const verifyFails = expect(verifying).rejects.toBeInstanceOf(WinHelperError);
      await vi.advanceTimersByTimeAsync(60_000);
      const asking = helper.call({ op: 'hello.available' });
      const askFails = expect(asking).rejects.toMatchObject({ code: 'failed' });
      await vi.advanceTimersByTimeAsync(1_000);
      await askFails;
      await verifyFails;
      await expect(helper.call({ op: 'status' })).resolves.toEqual({ protocol: 1 });
      expect(helpers).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a waiting verify when the helper crashes or is stopped', async () => {
    const { helper, helpers } = setup();
    await helper.call({ op: 'status' });
    helpers[0]!.hold.add('hello.verify');
    const lost = helper.call({ op: 'hello.verify', message: 'Unlock', window: null });
    helpers[0]!.child.emit('exit', 3);
    await expect(lost).rejects.toMatchObject({ code: 'failed' });
    await helper.call({ op: 'status' });
    helpers[1]!.hold.add('hello.verify');
    const stopped = helper.call({ op: 'hello.verify', message: 'Unlock', window: null });
    helper.kill();
    await expect(stopped).rejects.toMatchObject({ code: 'stopped' });
  });
});

describe('the Windows helper environment', () => {
  it('keeps only what Windows needs to activate WinRT', () => {
    expect(
      winHelperEnv({ SystemRoot: 'C:\\Windows', windir: 'C:\\Windows', GH_TOKEN: 'x', PATH: 'p' }),
    ).toEqual({ SystemRoot: 'C:\\Windows', windir: 'C:\\Windows' });
  });
});
