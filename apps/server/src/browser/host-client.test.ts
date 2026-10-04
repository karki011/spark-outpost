import { describe, expect, it, vi } from 'vitest';
import { BROWSER_HOST_ENV, type BrowserBridgeToHost } from '@spark-outpost/contracts';
import { BrowserHostError, connectDesktopBrowser, createBrowserHostClient } from './host-client.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const tabsRequest = { op: 'tabs', chatId: CHAT, runId: null } as const;

function harness(timeoutMs = 1000) {
  const sent: BrowserBridgeToHost[] = [];
  let deliver: (message: unknown) => void = () => undefined;
  let next = 0;
  const host = createBrowserHostClient({
    port: {
      post: (message) => sent.push(message),
      subscribe: (listener) => {
        deliver = listener;
      },
    },
    timeoutMs,
    newId: () => `id-${(next += 1)}`,
  });
  return { host, sent, deliver: (message: unknown) => deliver(message) };
}

describe('browser host client in the worker', () => {
  it('matches an answer to its request and validates it', async () => {
    const { host, sent, deliver } = harness();
    const pending = host.request(tabsRequest);
    expect(sent).toEqual([{ kind: 'browser:request', id: 'id-1', request: tabsRequest }]);
    deliver({ kind: 'browser:response', id: 'other', ok: true, result: { tabs: [] } });
    deliver({ kind: 'browser:response', id: 'id-1', ok: true, result: { tabs: [] } });
    await expect(pending).resolves.toEqual({ tabs: [] });
  });

  it('rejects an answer in the wrong shape', async () => {
    const { host, deliver } = harness();
    const pending = host.request(tabsRequest);
    deliver({ kind: 'browser:response', id: 'id-1', ok: true, result: { tabs: 'all of them' } });
    await expect(pending).rejects.toMatchObject({ code: 'invalid' });
  });

  it('passes the host error code through', async () => {
    const { host, deliver } = harness();
    const pending = host.request(tabsRequest);
    deliver({ kind: 'browser:response', id: 'id-1', ok: false, code: 'no_tab', message: 'None.' });
    await expect(pending).rejects.toMatchObject({ code: 'no_tab', message: 'None.' });
  });

  it('times out, tells the host to cancel and ignores a late answer', async () => {
    vi.useFakeTimers();
    try {
      const { host, sent, deliver } = harness(50);
      const pending = host.request(tabsRequest);
      const failed = expect(pending).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(60);
      await failed;
      expect(sent.at(-1)).toEqual({ kind: 'browser:cancel', id: 'id-1' });
      deliver({ kind: 'browser:response', id: 'id-1', ok: true, result: { tabs: [] } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels when the tool call is aborted', async () => {
    const { host, sent } = harness();
    const controller = new AbortController();
    const pending = host.request(tabsRequest, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BrowserHostError);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(sent.at(-1)).toEqual({ kind: 'browser:cancel', id: 'id-1' });
    const already = new AbortController();
    already.abort();
    await expect(host.request(tabsRequest, already.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(sent).toHaveLength(2);
  });
});

describe('finding the desktop shell', () => {
  const parentPort = { postMessage: () => undefined, on: () => undefined };

  it('has no host outside the Mac app', () => {
    expect(connectDesktopBrowser({}, { parentPort })).toBeNull();
    expect(connectDesktopBrowser({ [BROWSER_HOST_ENV]: '1' }, {})).toBeNull();
  });

  it('connects when the shell forked the worker and said so', () => {
    const posted: unknown[] = [];
    const browser = connectDesktopBrowser(
      { [BROWSER_HOST_ENV]: '1' },
      { parentPort: { ...parentPort, postMessage: (message: unknown) => posted.push(message) } },
    );
    browser!.blockPorts([61884]);
    expect(posted).toEqual([{ kind: 'browser:ports', ports: [61884] }]);
  });
});
