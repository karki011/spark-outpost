import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startHelper: vi.fn(),
  seed: vi.fn(),
  powerOn: vi.fn(),
  helperCall: vi.fn(async () => ({ authorization: 'fullAccess' })),
}));

vi.mock('electron', () => ({
  powerMonitor: { on: mocks.powerOn, off: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('./helper-process.ts', () => ({
  startCalendarHelper: (...args: unknown[]) => {
    mocks.startHelper(...args);
    return { call: mocks.helperCall, kill: vi.fn(), running: false };
  },
}));
vi.mock('./seed.ts', () => ({ runCalendarSeed: mocks.seed }));

const { startCalendarHost } = await import('./host.ts');

const options = { helperPath: '/helper', seedPath: null, log: () => undefined };

async function ask(platform: NodeJS.Platform, request: unknown) {
  const posted: unknown[] = [];
  const host = startCalendarHost({ ...options, platform });
  const worker = host.connectWorker({ post: (message) => posted.push(message) });
  worker.receive({ kind: 'calendar:request', id: 'one', request });
  await vi.waitFor(() => expect(posted).toHaveLength(1));
  host.dispose();
  return posted[0];
}

describe('calendar host platform', () => {
  it('on Windows reports macOS Calendar as unsupported and never starts the helper', async () => {
    mocks.startHelper.mockClear();
    mocks.seed.mockClear();
    mocks.powerOn.mockClear();
    expect(await ask('win32', { op: 'status' })).toEqual({
      kind: 'calendar:response',
      id: 'one',
      ok: true,
      result: { helper: 'unsupported', authorization: null },
    });
    expect(await ask('win32', { op: 'window' })).toMatchObject({ ok: false, code: 'missing' });
    expect(await ask('win32', { op: 'stop' })).toMatchObject({ ok: true });
    expect(mocks.startHelper).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
    expect(mocks.powerOn).not.toHaveBeenCalled();
    expect(mocks.helperCall).not.toHaveBeenCalled();
  });

  it('on macOS asks the helper as before', async () => {
    mocks.startHelper.mockClear();
    expect(await ask('darwin', { op: 'status' })).toMatchObject({
      ok: true,
      result: { helper: 'ready', authorization: 'fullAccess' },
    });
    expect(mocks.startHelper).toHaveBeenCalledOnce();
    expect(mocks.seed).toHaveBeenCalledOnce();
  });
});
