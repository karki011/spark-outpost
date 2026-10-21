import { describe, expect, it } from 'vitest';
import type { AttentionRequest } from '@spark-outpost/contracts';
import {
  decideAttention,
  dockBadge,
  NO_ATTENTION,
  noticesFor,
  parseAttentionReport,
  seenInSpark,
  withdrawn,
  type AttentionContext,
} from './attention.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const OTHER = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const THIRD = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function request(key: string, chatId = CHAT, chat = 'Fix login'): AttentionRequest {
  return {
    key,
    chatId,
    chat,
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
    viewed: new Set(),
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

describe('noticesFor', () => {
  it('names the chat for a single new request and opens it', () => {
    expect(noticesFor([request('a')])).toEqual([
      {
        key: 'a',
        chatId: CHAT,
        title: 'Spark needs you: Fix login',
        body: 'Claude wants to run a command',
        requests: ['a'],
        chats: [CHAT],
      },
    ]);
  });

  it('sums up several new requests in one notice that opens Spark', () => {
    const fresh = [
      request('a'),
      request('b', OTHER, 'Add tests'),
      request('c', THIRD, 'Ship docs'),
    ];
    expect(noticesFor(fresh)).toEqual([
      {
        key: 'summary:a',
        chatId: null,
        title: '3 chats need you',
        body: 'Fix login, Add tests and 1 more',
        requests: ['a', 'b', 'c'],
        chats: [CHAT, OTHER, THIRD],
      },
    ]);
  });

  it('counts chats, not requests, when one chat asks twice', () => {
    expect(noticesFor([request('a'), request('b')])).toEqual([
      {
        key: 'a',
        chatId: CHAT,
        title: 'Spark needs you: Fix login',
        body: 'Claude wants to run a command',
        requests: ['a', 'b'],
        chats: [CHAT],
      },
    ]);
    const [notice] = noticesFor([request('a'), request('b'), request('c', OTHER, 'Add tests')]);
    expect(notice).toMatchObject({ title: '2 chats need you', chats: [CHAT, OTHER] });
  });

  it('names both chats when two are new', () => {
    const [notice] = noticesFor([request('a'), request('b', OTHER, 'Add tests')]);
    expect(notice).toMatchObject({ title: '2 chats need you', body: 'Fix login and Add tests' });
  });

  it('shows one summary for the requests already waiting when Spark starts unwatched', () => {
    const report = { count: 3, requests: [request('a'), request('b', OTHER), request('c', THIRD)] };
    const launch = decideAttention(context({ report }));
    expect(launch.notify.map((notice) => notice.title)).toEqual(['3 chats need you']);
    expect(decideAttention(context({ report, seen: launch.seen })).notify).toEqual([]);
  });

  it('names the chat again for one request that arrives after the summary', () => {
    const report = { count: 2, requests: [request('a'), request('b', OTHER)] };
    const launch = decideAttention(context({ report }));
    const next = { count: 3, requests: [...report.requests, request('c', OTHER)] };
    const later = decideAttention(context({ report: next, seen: launch.seen }));
    expect(later.notify.map((notice) => notice.key)).toEqual(['c']);
  });
});

describe('a chat the user is viewing', () => {
  it('is never notified, then or later', () => {
    const viewed = new Set([CHAT]);
    const looking = decideAttention(context({ viewed }));
    expect(looking.notify).toEqual([]);
    expect(decideAttention(context({ seen: looking.seen })).notify).toEqual([]);
  });

  it('still lets a different chat notify', () => {
    const report = { count: 2, requests: [request('a'), request('b', OTHER)] };
    const decision = decideAttention(context({ report, viewed: new Set([CHAT]) }));
    expect(decision.notify.map((notice) => notice.key)).toEqual(['b']);
  });

  it('clears a shown notice once its chat is opened, and a summary once all its chats are', () => {
    const [single] = noticesFor([request('a')]);
    expect(seenInSpark(single!, new Set([OTHER]))).toBe(false);
    expect(seenInSpark(single!, new Set([CHAT]))).toBe(true);
    const [summary] = noticesFor([request('a'), request('b', OTHER)]);
    expect(seenInSpark(summary!, new Set([CHAT]))).toBe(false);
    expect(seenInSpark(summary!, new Set([CHAT, OTHER]))).toBe(true);
  });
});

describe('withdrawn', () => {
  it('keeps a summary while any of its requests still waits', () => {
    const [summary] = noticesFor([request('a'), request('b', OTHER)]);
    expect(withdrawn(summary!, new Set(['b']))).toBe(false);
    expect(withdrawn(summary!, new Set(['c']))).toBe(true);
  });

  it('withdraws a single notice once its request is answered', () => {
    const [notice] = noticesFor([request('a')]);
    expect(withdrawn(notice!, new Set(['a']))).toBe(false);
    expect(withdrawn(notice!, new Set())).toBe(true);
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
    expect(parseAttentionReport({ count: 1, requests: [{ ...request('a'), chat: 7 }] })).toBeNull();
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
