import { describe, expect, it, vi } from 'vitest';
import { connectWorkerBridge } from './bridge.ts';

vi.mock('electron', () => ({}));

const CHAT = '11111111-2222-4333-8444-555555555555';
const tabsRequest = { op: 'tabs', chatId: CHAT, runId: null };

function harness(run: (request: unknown, signal: AbortSignal) => Promise<unknown>) {
  const sent: unknown[] = [];
  const ports: number[] = [];
  const bridge = connectWorkerBridge(
    { post: (message) => sent.push(message) },
    { run, ports: (list) => ports.push(...list) },
  );
  return { bridge, sent, ports };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

describe('worker bridge in the main process', () => {
  it('answers a request with its id', async () => {
    const { bridge, sent } = harness(async () => ({ tabs: [] }));
    bridge.receive({ kind: 'browser:request', id: 'r1', request: tabsRequest });
    await settled();
    expect(sent).toEqual([{ kind: 'browser:response', id: 'r1', ok: true, result: { tabs: [] } }]);
  });

  it('refuses a request that does not match the schema', async () => {
    const run = vi.fn(async () => ({}));
    const { bridge, sent } = harness(run);
    bridge.receive({ kind: 'browser:request', id: 'r2', request: { op: 'click', chatId: CHAT } });
    bridge.receive({ kind: 'something-else' });
    bridge.receive(null);
    await settled();
    expect(run).not.toHaveBeenCalled();
    expect(sent).toEqual([expect.objectContaining({ id: 'r2', ok: false, code: 'failed' })]);
  });

  it('aborts the running work on cancel and reports it cancelled', async () => {
    let seen: AbortSignal | null = null;
    const { bridge, sent } = harness(
      (_request, signal) =>
        new Promise((resolve) => {
          seen = signal;
          signal.addEventListener('abort', () => resolve({ tabs: [] }));
        }),
    );
    bridge.receive({ kind: 'browser:request', id: 'r3', request: tabsRequest });
    bridge.receive({ kind: 'browser:cancel', id: 'r3' });
    await settled();
    expect(seen!.aborted).toBe(true);
    expect(sent).toEqual([expect.objectContaining({ id: 'r3', ok: false, code: 'cancelled' })]);
  });

  it('ignores a repeated id while the first is running and stays quiet after close', async () => {
    const run = vi.fn(() => new Promise(() => undefined));
    const { bridge, sent } = harness(run);
    bridge.receive({ kind: 'browser:request', id: 'r4', request: tabsRequest });
    bridge.receive({ kind: 'browser:request', id: 'r4', request: tabsRequest });
    expect(run).toHaveBeenCalledTimes(1);
    bridge.close();
    await settled();
    expect(sent).toEqual([]);
  });

  it('takes the ports the worker asks to block', () => {
    const { bridge, ports } = harness(async () => ({}));
    bridge.receive({ kind: 'browser:ports', ports: [61884] });
    expect(ports).toEqual([61884]);
  });
});
