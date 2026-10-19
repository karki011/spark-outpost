import { describe, expect, it } from 'vitest';
import type { BrowserNetworkEntry } from '@spark-outpost/contracts';
import { maxInFlight, networkLine, statusRange, viewNetwork } from './network-view.ts';

function request(
  url: string,
  startMs: number,
  endMs: number | null,
  extra: Partial<BrowserNetworkEntry> = {},
): BrowserNetworkEntry {
  return {
    at: '2026-10-19T10:00:00.000Z',
    method: 'GET',
    url,
    status: endMs === null ? null : 200,
    type: 'Fetch',
    initiator: 'script https://app.example/main.js:1:20',
    startMs,
    endMs,
    encodedBytes: endMs === null ? null : 512,
    decodedBytes: endMs === null ? null : 2048,
    fromCache: false,
    failed: null,
    ...extra,
  };
}

const API = 'https://api.example/grouped_costs';

const parallelPage = [
  request(`${API}?offset=100`, 12, 480),
  request(`${API}?offset=0`, 10, 400),
  request(`${API}?offset=0`, 9, 15, { method: 'OPTIONS', status: 204, type: 'Preflight' }),
  request(`${API}?offset=50`, 11, 455),
  request('https://app.example/app.js', 0, 8, {
    type: 'Script',
    initiator: 'parser https://app.example/:4',
  }),
  request('https://api.example/broken', 500, 520, { status: 500 }),
  request('https://api.example/slow', 520, null),
];

const all = { limit: 50 };

describe('viewing the network log', () => {
  it('sorts by start and shows that the grouped_costs requests overlapped', () => {
    const view = viewNetwork(parallelPage, { ...all, filter: 'grouped_costs' });
    expect(view.lines.map((line) => line.split(' · ')[4])).toEqual([
      `${API}?offset=0`,
      `${API}?offset=50`,
      `${API}?offset=100`,
    ]);
    expect(view.maxInFlight).toBe(3);
    expect(view.hiddenPreflight).toBe(1);
    expect(view.lines[0]).toBe(
      `+10ms → +400ms (390ms) · GET · 200 · Fetch · ${API}?offset=0 · 512 B (body 2.0 kB) · by script https://app.example/main.js:1:20`,
    );
  });

  it('tells sequential requests from parallel ones', () => {
    const one = [
      request('https://a/1', 0, 100),
      request('https://a/2', 100, 200),
      request('https://a/3', 200, 300),
    ];
    expect(maxInFlight(one)).toBe(1);
    expect(maxInFlight([request('https://a/1', 0, null), request('https://a/2', 500, 600)])).toBe(
      2,
    );
  });

  it('shows preflights only when asked for OPTIONS or ANY', () => {
    expect(viewNetwork(parallelPage, { ...all, method: 'options' }).lines).toHaveLength(1);
    const any = viewNetwork(parallelPage, { ...all, method: 'ANY' });
    expect(any.matched).toBe(7);
    expect(any.hiddenPreflight).toBe(0);
    expect(viewNetwork(parallelPage, { ...all, method: 'POST' }).matched).toBe(0);
  });

  it('filters by status, type and start time, and keeps the newest when limited', () => {
    expect(viewNetwork(parallelPage, { ...all, status: '5xx' }).lines[0]).toContain('/broken');
    expect(viewNetwork(parallelPage, { ...all, status: '400-599' }).matched).toBe(1);
    expect(viewNetwork(parallelPage, { ...all, type: 'script' }).matched).toBe(1);
    const late = viewNetwork(parallelPage, { ...all, since: 500 });
    expect(late.matched).toBe(2);
    expect(late.pending).toBe(1);
    expect(late.lines[1]).toBe(
      '+520ms → pending · GET · … · Fetch · https://api.example/slow · by script https://app.example/main.js:1:20',
    );
    const newest = viewNetwork(parallelPage, { limit: 2 });
    expect(newest.matched).toBe(6);
    expect(newest.lines.map((line) => line.split(' · ')[4])).toEqual([
      'https://api.example/broken',
      'https://api.example/slow',
    ]);
  });

  it('reads status filters', () => {
    expect(statusRange('404')).toEqual({ min: 404, max: 404 });
    expect(statusRange('4XX')).toEqual({ min: 400, max: 499 });
    expect(statusRange('200 - 299')).toEqual({ min: 200, max: 299 });
    expect(statusRange('bad')).toBeNull();
  });

  it('writes failures and cached answers plainly', () => {
    expect(
      networkLine(
        request('https://a/x', 1.25, 3, { failed: 'canceled', fromCache: true, initiator: null }),
      ),
    ).toBe(
      '+1.3ms → +3ms (1.8ms) · GET · failed: canceled · Fetch · https://a/x · 512 B (body 2.0 kB) · from cache',
    );
  });
});
