import { describe, expect, it, vi } from 'vitest';
import type { WinHelper } from './win-helper/helper-process.ts';
import { WinHelperError } from './win-helper/helper-process.ts';
import { windowHandle, windowsHello } from './windows-hello.ts';

interface Scene {
  protocol: number;
  available: boolean | Error;
  outcome: string | Error;
  calls: Record<string, unknown>[];
  killed: number;
}

function setup(overrides: Partial<Scene> = {}) {
  const scene: Scene = {
    protocol: 1,
    available: true,
    outcome: 'verified',
    calls: [],
    killed: 0,
    ...overrides,
  };
  const answer = (value: unknown) =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  const helper = {
    call: (request: Record<string, unknown>) => {
      scene.calls.push(request);
      if (request.op === 'status') return answer({ protocol: scene.protocol });
      if (request.op === 'hello.available')
        return answer(
          scene.available instanceof Error ? scene.available : { available: scene.available },
        );
      return answer(scene.outcome instanceof Error ? scene.outcome : { outcome: scene.outcome });
    },
    kill: () => void (scene.killed += 1),
  } as unknown as WinHelper;
  const log = vi.fn();
  const hello = windowsHello({
    binary: 'C:\\helper.exe',
    log,
    exists: () => true,
    start: () => helper,
  });
  return { hello, scene, log };
}

describe('Windows Hello', () => {
  it('is unavailable until asked, then reports a change once', async () => {
    const { hello, scene } = setup();
    expect(hello.available()).toBe(false);
    expect(await hello.refresh()).toBe(true);
    expect(hello.available()).toBe(true);
    expect(await hello.refresh()).toBe(false);
    expect(scene.calls.map((call) => call.op)).toEqual([
      'status',
      'hello.available',
      'hello.available',
    ]);
  });

  it('maps each outcome and passes the message and window on', async () => {
    const outcomes = {
      verified: 'ok',
      cancelled: 'cancelled',
      unavailable: 'unavailable',
      error: 'failed',
    };
    for (const [outcome, expected] of Object.entries(outcomes)) {
      const { hello, scene } = setup({ outcome });
      await hello.refresh();
      expect(await hello.verify('Unlock Spark Outpost', '123')).toBe(expected);
      expect(scene.calls.at(-1)).toEqual({
        op: 'hello.verify',
        message: 'Unlock Spark Outpost',
        window: '123',
      });
    }
  });

  it('fails when the helper fails or crashes during the dialog', async () => {
    const { hello, scene, log } = setup();
    await hello.refresh();
    scene.outcome = new WinHelperError('failed', 'The Windows helper exited (3).');
    expect(await hello.verify('Unlock', null)).toBe('failed');
    expect(log).toHaveBeenCalledWith('Windows Hello failed: The Windows helper exited (3).');
  });

  it('never asks while Windows Hello is not set up', async () => {
    const { hello, scene } = setup({ available: false });
    await hello.refresh();
    expect(await hello.verify('Unlock', null)).toBe('unavailable');
    expect(scene.calls.some((call) => call.op === 'hello.verify')).toBe(false);
  });

  it('is unavailable when the helper speaks another protocol or cannot answer', async () => {
    const other = setup({ protocol: 2 });
    expect(await other.hello.refresh()).toBe(false);
    expect(other.hello.available()).toBe(false);
    expect(other.log).toHaveBeenCalledWith(expect.stringContaining('protocol 2'));
    const broken = setup({ available: new Error('exited (1)') });
    await broken.hello.refresh();
    expect(broken.hello.available()).toBe(false);
  });

  it('is unavailable, and says how to build it, when the helper is missing', async () => {
    const log = vi.fn();
    const start = vi.fn();
    const hello = windowsHello({ binary: 'C:\\gone.exe', log, exists: () => false, start });
    expect(await hello.refresh()).toBe(false);
    expect(await hello.verify('Unlock', null)).toBe('unavailable');
    expect(start).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toContain('pnpm desktop:win-helper');
  });

  it('stops the helper when disposed', () => {
    const { hello, scene } = setup();
    hello.dispose();
    expect(scene.killed).toBe(1);
  });
});

describe('window handles', () => {
  it('reads a 64-bit handle as an exact decimal string', () => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(18_446_744_073_709_551_615n);
    expect(windowHandle(handle)).toBe('18446744073709551615');
  });

  it('reads a 32-bit handle and refuses an empty one', () => {
    const handle = Buffer.alloc(4);
    handle.writeUInt32LE(4242);
    expect(windowHandle(handle)).toBe('4242');
    expect(windowHandle(Buffer.alloc(0))).toBeNull();
    expect(windowHandle(null)).toBeNull();
  });
});
