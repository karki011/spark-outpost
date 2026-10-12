import { describe, expect, it } from 'vitest';
import {
  decideAttention,
  dockBadge,
  NO_ATTENTION,
  parseAttentionReport,
  type AttentionContext,
  type AttentionRequest,
} from './attention.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const OTHER = '66666666-7777-4888-8999-aaaaaaaaaaaa';

function request(key: string, chatId = CHAT): AttentionRequest {
  return {
    key,
    chatId,
    title: 'Spark needs you: Fix login',
    body: 'Claude wants to run a command',
  };
}

function context(overrides: Partial<AttentionContext>): AttentionContext {
  return {
    report: { count: 1, requests: [request('a')] },
    seen: new Set(),
    enabled: true,
    islandShowing: false,
    sparkFocused: false,
    ...overrides,
  };
}

describe('decideAttention', () => {
  it('notifies for a new request when the island is off and Spark is not focused', () => {
    const decision = decideAttention(context({}));
    expect(decision.notify.map((item) => item.key)).toEqual(['a']);
    expect([...decision.seen]).toEqual(['a']);
  });

  it('notifies once per request', () => {
    const first = decideAttention(context({}));
    const second = decideAttention(context({ seen: first.seen }));
    expect(second.notify).toEqual([]);
  });

  it('notifies only for the request that is new', () => {
    const report = { count: 2, requests: [request('a'), request('b', OTHER)] };
    const decision = decideAttention(context({ report, seen: new Set(['a']) }));
    expect(decision.notify.map((item) => item.key)).toEqual(['b']);
  });

  it('stays quiet while the user is looking at Spark, and does not notify later', () => {
    const focused = decideAttention(context({ sparkFocused: true }));
    expect(focused.notify).toEqual([]);
    const later = decideAttention(context({ seen: focused.seen }));
    expect(later.notify).toEqual([]);
  });

  it('stays quiet while Spark Island shows the request, and after it is turned off', () => {
    const shown = decideAttention(context({ islandShowing: true }));
    expect(shown.notify).toEqual([]);
    expect(decideAttention(context({ seen: shown.seen })).notify).toEqual([]);
  });

  it('stays quiet when the setting is off, and when it is turned on later', () => {
    const off = decideAttention(context({ enabled: false }));
    expect(off.notify).toEqual([]);
    expect(decideAttention(context({ seen: off.seen })).notify).toEqual([]);
  });

  it('notifies again when the same chat asks again after it stopped waiting', () => {
    const first = decideAttention(context({}));
    const answered = decideAttention(context({ report: NO_ATTENTION, seen: first.seen }));
    expect(answered.seen.size).toBe(0);
    expect(decideAttention(context({ seen: answered.seen })).notify).toHaveLength(1);
  });

  it('notifies once when a report repeats a request', () => {
    const report = { count: 1, requests: [request('a'), request('a')] };
    expect(decideAttention(context({ report })).notify).toHaveLength(1);
  });
});

describe('dockBadge', () => {
  it('shows the count of chats that need the user', () => {
    expect(dockBadge(null, 3, true)).toBe('3');
  });

  it('clears at zero', () => {
    expect(dockBadge(null, 0, true)).toBe('');
  });

  it('keeps the channel badge and adds the count beside it', () => {
    expect(dockBadge('DEV', 0, true)).toBe('DEV');
    expect(dockBadge('DEV', 2, true)).toBe('DEV 2');
  });

  it('shows no count when the setting is off', () => {
    expect(dockBadge(null, 4, false)).toBe('');
    expect(dockBadge('DEV', 4, false)).toBe('DEV');
  });
});

describe('parseAttentionReport', () => {
  it('accepts a well-formed report', () => {
    const report = { count: 1, requests: [request('a')] };
    expect(parseAttentionReport(report)).toEqual(report);
  });

  it('refuses anything that is not a report', () => {
    expect(parseAttentionReport(null)).toBeNull();
    expect(parseAttentionReport({ count: -1, requests: [] })).toBeNull();
    expect(parseAttentionReport({ count: 1.5, requests: [] })).toBeNull();
    expect(parseAttentionReport({ count: 1, requests: 'a' })).toBeNull();
    expect(
      parseAttentionReport({ count: 1, requests: [{ ...request('a'), chatId: 'x' }] }),
    ).toBeNull();
    expect(parseAttentionReport({ count: 1, requests: [{ ...request('a'), key: '' }] })).toBeNull();
    expect(
      parseAttentionReport({ count: 1, requests: [{ ...request('a'), title: ' ' }] }),
    ).toBeNull();
  });

  it('keeps notification text to one short line', () => {
    const long = {
      ...request('a'),
      title: `Spark needs you:\n${'x'.repeat(300)}`,
      body: 'y'.repeat(500),
    };
    const parsed = parseAttentionReport({ count: 1, requests: [long] })!;
    expect(parsed.requests[0]!.title).toHaveLength(120);
    expect(parsed.requests[0]!.title).not.toContain('\n');
    expect(parsed.requests[0]!.body).toHaveLength(200);
  });

  it('caps the count and the number of requests', () => {
    const requests = Array.from({ length: 80 }, (_, index) => request(`k${index}`));
    const parsed = parseAttentionReport({ count: 123_456, requests })!;
    expect(parsed.count).toBe(9_999);
    expect(parsed.requests).toHaveLength(50);
  });
});
