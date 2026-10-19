import { describe, expect, it } from 'vitest';
import type { Cdp, CdpListener } from './cdp.ts';
import { capturePageLogs, stackText } from './page-capture.ts';

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

const WALL = 1_790_000_000_000;
const MONO = 5000;
const frames = [
  {
    functionName: 'loadCosts',
    url: 'https://app.example/main.js?v=3&sig=abc',
    lineNumber: 41,
    columnNumber: 9,
  },
  { functionName: '', url: 'https://app.example/vendor.js', lineNumber: 0, columnNumber: 120 },
];

describe('the console a page writes', () => {
  it('keeps uncaught errors and unhandled rejections with their stack', async () => {
    const { cdp, emit } = fakeCdp();
    const logs = await capturePageLogs(cdp);
    emit('Runtime.exceptionThrown', {
      timestamp: WALL,
      exceptionDetails: {
        text: 'Uncaught',
        url: 'https://app.example/main.js?v=3&sig=abc',
        lineNumber: 41,
        columnNumber: 9,
        exception: {
          description:
            "TypeError: Cannot read properties of undefined (reading 'rows')\n    at loadCosts",
        },
        stackTrace: { callFrames: frames },
      },
    });
    emit('Runtime.exceptionThrown', {
      timestamp: WALL + 30,
      exceptionDetails: {
        text: 'Uncaught (in promise)',
        exception: { description: 'Error: grouped_costs failed with 500' },
        stackTrace: { callFrames: [frames[0]] },
      },
    });
    const [thrown, rejected] = logs.console.recent(undefined, 10);
    expect(thrown).toMatchObject({
      level: 'error',
      text: "TypeError: Cannot read properties of undefined (reading 'rows')",
      source: 'https://app.example/main.js?v=3&sig=[redacted]:42:10',
      ms: 0,
      stack:
        'at loadCosts https://app.example/main.js?v=3&sig=[redacted]:42:10\nat (anonymous) https://app.example/vendor.js:1:121',
    });
    expect(rejected).toMatchObject({
      text: 'Unhandled rejection: Error: grouped_costs failed with 500',
      ms: 30,
    });
  });

  it('keeps failed resource loads, and lines console and network up on one clock', async () => {
    const { cdp, emit } = fakeCdp();
    const logs = await capturePageLogs(cdp);
    emit('Network.requestWillBeSent', {
      requestId: '1',
      request: { url: 'https://app.example/api/costs', method: 'GET' },
      timestamp: MONO,
      wallTime: WALL / 1000,
    });
    emit('Runtime.consoleAPICalled', {
      type: 'warn',
      timestamp: WALL + 120,
      args: [{ type: 'string', value: 'Slow response' }],
    });
    emit('Network.loadingFinished', { requestId: '1', timestamp: MONO + 0.25 });
    emit('Log.entryAdded', {
      entry: {
        source: 'network',
        level: 'error',
        text: 'Failed to load resource: the server responded with a status of 404 ()',
        url: 'https://app.example/missing.png?token=t1',
        timestamp: WALL + 300,
      },
    });
    const lines = logs.console.recent(undefined, 10);
    expect(lines.map((entry) => [entry.level, entry.ms])).toEqual([
      ['warning', 120],
      ['error', 300],
    ]);
    expect(lines[1]!.text).toBe(
      'Failed to load resource: the server responded with a status of 404 (): https://app.example/missing.png?token=[redacted]',
    );
    expect(logs.network.all()[0]).toMatchObject({ startMs: 0, endMs: 250 });
  });

  it('writes no stack when no frame has an address', () => {
    expect(stackText([{ functionName: 'x' }])).toBeNull();
    expect(stackText(undefined)).toBeNull();
  });
});
