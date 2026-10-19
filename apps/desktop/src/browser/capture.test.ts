import { describe, expect, it } from 'vitest';
import { BoundedLog, withoutQuery } from './bounded-log.ts';
import type { Cdp, CdpListener } from './cdp.ts';
import { paintBoxes, quadBox, scaledBox } from './mask.ts';
import { capturePageLogs } from './page-capture.ts';

const entry = (text: string, level = 'log') => ({
  level,
  text,
  source: null,
  status: null,
  method: null,
});

describe('bounded page logs', () => {
  it('keeps the newest entries and counts what it dropped', () => {
    const log = new BoundedLog(3);
    for (const text of ['a', 'b', 'c', 'd', 'e']) log.push(entry(text));
    expect(log.recent(undefined, 10).map((item) => item.text)).toEqual(['c', 'd', 'e']);
    expect(log.dropped()).toBe(2);
    expect(log.recent(undefined, 2).map((item) => item.text)).toEqual(['d', 'e']);
  });

  it('filters without regard to case and clips long text', () => {
    const log = new BoundedLog();
    log.push(entry('Widget FAILED to load', 'error'));
    log.push(entry('x'.repeat(5000)));
    expect(log.recent('failed', 10)).toHaveLength(1);
    expect(log.recent('error', 10)).toHaveLength(1);
    expect(log.recent(undefined, 10)[1]!.text.length).toBeLessThanOrEqual(500);
  });

  it('never keeps a query string', () => {
    expect(withoutQuery('http://localhost:3000/api?token=secret#x')).toBe(
      'http://localhost:3000/api?…',
    );
    expect(withoutQuery('http://localhost:3000/api')).toBe('http://localhost:3000/api');
  });
});

function fakeCdp() {
  const listeners = new Set<CdpListener>();
  const cdp: Cdp = {
    send: () => Promise.resolve({} as never),
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    detach: () => listeners.clear(),
  };
  const emit = (method: string, params: Record<string, unknown>) => {
    for (const listener of listeners) listener(method, params);
  };
  return { cdp, emit };
}

describe('page log capture', () => {
  const say = (text: string) => ({ type: 'log', args: [{ type: 'string', value: text }] });
  const request = (id: string, url: string) => ({ requestId: id, request: { url, method: 'GET' } });

  it('starts over when the tab goes to another page', async () => {
    const { cdp, emit } = fakeCdp();
    const logs = await capturePageLogs(cdp);
    emit('Runtime.consoleAPICalled', say('from the old page'));
    emit('Network.requestWillBeSent', request('1', 'http://localhost:3000/old.json'));
    emit('Network.responseReceived', { requestId: '1', response: { status: 404 } });
    emit('Network.requestWillBeSent', request('2', 'http://localhost:3000/slow.json'));

    logs.reset();
    emit('Network.loadingFailed', { requestId: '2', errorText: 'net::ERR_ABORTED' });
    emit('Runtime.consoleAPICalled', say('from the new page'));
    emit('Network.requestWillBeSent', request('3', 'http://localhost:3000/new.json?token=1'));
    emit('Network.responseReceived', { requestId: '3', response: { status: 200 } });

    expect(logs.console.recent(undefined, 10).map((entry) => entry.text)).toEqual([
      'from the new page',
    ]);
    expect(
      logs.network.all().map((entry) => `${entry.method} ${entry.url} ${entry.status}`),
    ).toEqual(['GET http://localhost:3000/new.json?token=[redacted] 200']);
    expect(logs.console.dropped()).toBe(0);
  });

  it('leaves out the warnings the development shell prints into every page', async () => {
    const { cdp, emit } = fakeCdp();
    const logs = await capturePageLogs(cdp);
    emit('Runtime.consoleAPICalled', {
      type: 'warning',
      args: [
        {
          type: 'string',
          value:
            '%cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold; This renderer process has no Content Security Policy set',
        },
      ],
    });
    emit('Runtime.consoleAPICalled', say('Kite string snapped'));
    expect(logs.console.recent(undefined, 10).map((entry) => entry.text)).toEqual([
      'Kite string snapped',
    ]);
  });
});

describe('screenshot masking', () => {
  it('paints only the pixels inside the box', () => {
    const size = { width: 4, height: 3 };
    const bitmap = Buffer.alloc(size.width * size.height * 4, 255);
    const painted = paintBoxes(bitmap, size, [{ x: 1, y: 1, width: 2, height: 1 }]);
    const pixel = (x: number, y: number) => painted[(y * size.width + x) * 4];
    expect(pixel(0, 1)).toBe(255);
    expect(pixel(1, 1)).toBe(96);
    expect(pixel(2, 1)).toBe(96);
    expect(pixel(3, 1)).toBe(255);
    expect(pixel(1, 0)).toBe(255);
    expect(bitmap[(1 * size.width + 1) * 4]).toBe(255);
  });

  it('clips boxes that reach outside the image', () => {
    const size = { width: 2, height: 2 };
    const painted = paintBoxes(Buffer.alloc(16, 255), size, [
      { x: -5, y: -5, width: 100, height: 100 },
    ]);
    expect([...painted].filter((byte) => byte === 96)).toHaveLength(12);
  });

  it('maps page boxes into the scaled crop', () => {
    expect(scaledBox({ x: 110, y: 60, width: 40, height: 20 }, 0.5, { x: 100, y: 50 })).toEqual({
      x: 5,
      y: 5,
      width: 20,
      height: 10,
    });
    expect(quadBox([10, 20, 50, 20, 50, 40, 10, 40])).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 20,
    });
    expect(quadBox([1, 2])).toBeNull();
  });
});
