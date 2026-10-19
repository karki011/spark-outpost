import { describe, expect, it } from 'vitest';
import { NetworkLog, initiatorText } from './network-capture.ts';

const T0 = 1000;

function sent(log: NetworkLog, id: string, url: string, at: number, extra: object = {}) {
  log.requestWillBeSent({
    requestId: id,
    request: { url, method: 'GET' },
    type: 'Fetch',
    timestamp: T0 + at,
    wallTime: 1_790_000_000 + at,
    ...extra,
  });
}

describe('the network log of a page', () => {
  it('records each request from start to finish with sizes and times from the first request', () => {
    const log = new NetworkLog();
    sent(log, '1', 'https://api.example/grouped_costs?offset=0&token=abc', 0);
    sent(log, '2', 'https://api.example/grouped_costs?offset=50', 0.01);
    log.responseReceived({ requestId: '1', type: 'Fetch', response: { status: 200 } });
    log.dataReceived({ requestId: '1', dataLength: 700 });
    log.dataReceived({ requestId: '1', dataLength: 300 });
    log.loadingFinished({ requestId: '1', timestamp: T0 + 0.25, encodedDataLength: 412 });

    const [first, second] = log.all();
    expect(first).toMatchObject({
      method: 'GET',
      url: 'https://api.example/grouped_costs?offset=0&token=[redacted]',
      status: 200,
      type: 'Fetch',
      startMs: 0,
      endMs: 250,
      encodedBytes: 412,
      decodedBytes: 1000,
      fromCache: false,
      failed: null,
    });
    expect(first!.at).toBe(new Date(1_790_000_000_000).toISOString());
    expect(second).toMatchObject({ startMs: 10, endMs: null, status: null });
  });

  it('keeps each hop of a redirect as its own entry', () => {
    const log = new NetworkLog();
    sent(log, '7', 'https://app.example/start', 0, { type: 'Document' });
    sent(log, '7', 'https://auth.example/login?state=xyz', 0.05, {
      type: 'Document',
      redirectResponse: { status: 302 },
    });
    log.responseReceived({ requestId: '7', response: { status: 200 } });
    log.loadingFinished({ requestId: '7', timestamp: T0 + 0.2, encodedDataLength: 90 });
    expect(log.all().map((entry) => [entry.url, entry.status, entry.endMs])).toEqual([
      ['https://app.example/start', 302, 50],
      ['https://auth.example/login?state=[redacted]', 200, 200],
    ]);
  });

  it('marks failures, cancelled requests and cached answers', () => {
    const log = new NetworkLog();
    sent(log, 'a', 'https://api.example/a', 0);
    sent(log, 'b', 'https://api.example/b', 0);
    sent(log, 'c', 'https://api.example/c', 0);
    log.loadingFailed({
      requestId: 'a',
      timestamp: T0 + 0.1,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });
    log.loadingFailed({
      requestId: 'b',
      timestamp: T0 + 0.1,
      canceled: true,
      errorText: 'net::ERR_ABORTED',
    });
    log.servedFromCache({ requestId: 'c' });
    log.responseReceived({ requestId: 'c', response: { status: 200, fromDiskCache: true } });
    expect(log.all().map((entry) => [entry.failed, entry.fromCache])).toEqual([
      ['net::ERR_CONNECTION_REFUSED', false],
      ['canceled', false],
      [null, true],
    ]);
  });

  it('keeps the newest requests when it is full, and starts over for a new page', () => {
    const log = new NetworkLog(3);
    for (const id of ['1', '2', '3', '4', '5'])
      sent(log, id, `https://a.example/${id}`, Number(id));
    expect(log.all().map((entry) => entry.url)).toEqual([
      'https://a.example/3',
      'https://a.example/4',
      'https://a.example/5',
    ]);
    expect(log.dropped()).toBe(2);
    log.loadingFinished({ requestId: '1', timestamp: T0 + 9 });
    expect(log.all()).toHaveLength(3);
    log.clear();
    log.loadingFinished({ requestId: '4', timestamp: T0 + 5 });
    log.loadingFailed({ requestId: '5', timestamp: T0 + 6, canceled: true });
    sent(log, '9', 'https://b.example/', 20);
    sent(log, '10', 'https://b.example/app.js', 20.01);
    expect(log.all().map((entry) => entry.startMs)).toEqual([0, 10]);
    expect(log.dropped()).toBe(0);
  });
});

describe('who started a request', () => {
  it('names the script frame, the parser line or the kind', () => {
    expect(
      initiatorText({
        type: 'script',
        stack: {
          callFrames: [
            { url: 'https://app.example/main.js?v=1&sig=x', lineNumber: 9, columnNumber: 4 },
          ],
        },
      }),
    ).toBe('script https://app.example/main.js?v=1&sig=[redacted]:10:5');
    expect(initiatorText({ type: 'parser', url: 'https://app.example/', lineNumber: 2 })).toBe(
      'parser https://app.example/:3',
    );
    expect(initiatorText({ type: 'other' })).toBe('other');
    expect(initiatorText(undefined)).toBeNull();
  });
});
