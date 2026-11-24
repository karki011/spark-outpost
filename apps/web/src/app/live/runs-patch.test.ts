import { describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  EMPTY_CONVERSATION_USAGE,
  type ConversationDetail,
  type ConversationRuns,
  type Run,
} from '@spark-outpost/contracts';
import { queryKeys } from '../../api/client.ts';
import { refreshChatRuns, withRuns } from './runs-patch.ts';

const CHAT = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const KEY = queryKeys.conversation(CHAT);

function run(id: string, contextUsed: number | null): Run {
  return {
    id,
    status: 'running',
    usage:
      contextUsed === null ? null : { contextUsed, contextSize: 1000, costUsd: null, tokens: null },
  } as unknown as Run;
}

function detail(runs: Run[], extra: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    runs,
    messages: [{ id: 'message' }],
    usageTotals: EMPTY_CONVERSATION_USAGE,
    ...extra,
  } as unknown as ConversationDetail;
}

function slice(runs: Run[], extra: Partial<ConversationRuns> = {}): ConversationRuns {
  return {
    runs,
    usageTotals: { costUsd: 0.5, totalTokens: 42, byProvider: [] },
    ...extra,
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Open {
  client: QueryClient;
  fetches: () => number;
  serve: (next: ConversationDetail) => void;
  close: () => void;
}

async function openChat(first: ConversationDetail): Promise<Open> {
  const client = new QueryClient();
  let served = first;
  let fetches = 0;
  const observer = new QueryObserver(client, {
    queryKey: KEY,
    staleTime: Infinity,
    queryFn: () => {
      fetches += 1;
      return Promise.resolve(served);
    },
  });
  const close = observer.subscribe(() => undefined);
  await settle();
  return {
    client,
    fetches: () => fetches,
    serve: (next) => {
      served = next;
    },
    close,
  };
}

const cached = (client: QueryClient) => client.getQueryData<ConversationDetail>(KEY);

describe('withRuns', () => {
  it('replaces the runs it knows, the totals and the prompt cache, and keeps everything else', () => {
    const advisors = [{ model: 'm' }] as unknown as NonNullable<
      ConversationDetail['usageTotals']['advisors']
    >;
    const before = detail([run(RUN, 100), run(OTHER, null)], {
      usageTotals: { ...EMPTY_CONVERSATION_USAGE, advisors },
      promptCache: { last: null, rebuilds: {} } as unknown as ConversationDetail['promptCache'],
    });
    const after = withRuns(before, slice([run(RUN, 700), run('unknown', 5)]));
    expect(after.runs.map((each) => each.usage?.contextUsed ?? null)).toEqual([700, null]);
    expect(after.runs[1]).toBe(before.runs[1]);
    expect(after.usageTotals).toEqual({ costUsd: 0.5, totalTokens: 42, byProvider: [], advisors });
    expect('promptCache' in after).toBe(false);
    expect(after.messages).toBe(before.messages);
  });
});

describe('refreshChatRuns', () => {
  it('patches the open chat from the runs slice without refetching the detail', async () => {
    const open = await openChat(detail([run(RUN, 100)]));
    let asked = 0;
    refreshChatRuns(open.client, CHAT, () => {
      asked += 1;
      return Promise.resolve(slice([run(RUN, 700)]));
    });
    await settle();
    expect(asked).toBe(1);
    expect(open.fetches()).toBe(1);
    expect(cached(open.client)?.runs[0]?.usage?.contextUsed).toBe(700);
    expect(cached(open.client)?.usageTotals.totalTokens).toBe(42);
    open.close();
  });

  it('asks once more after a burst and never runs two requests for one chat at a time', async () => {
    const open = await openChat(detail([run(RUN, 100)]));
    const waiting: ((value: ConversationRuns) => void)[] = [];
    const fetchRuns = () => new Promise<ConversationRuns>((resolve) => waiting.push(resolve));
    for (let reading = 0; reading < 5; reading += 1) refreshChatRuns(open.client, CHAT, fetchRuns);
    expect(waiting).toHaveLength(1);
    waiting[0]?.(slice([run(RUN, 200)]));
    await settle();
    expect(waiting).toHaveLength(2);
    waiting[1]?.(slice([run(RUN, 300)]));
    await settle();
    expect(waiting).toHaveLength(2);
    expect(cached(open.client)?.runs[0]?.usage?.contextUsed).toBe(300);
    open.close();
  });

  it('drops a slice read before the cache changed and reads again', async () => {
    const open = await openChat(detail([run(RUN, 100)]));
    const waiting: ((value: ConversationRuns) => void)[] = [];
    const fetchRuns = () => new Promise<ConversationRuns>((resolve) => waiting.push(resolve));
    refreshChatRuns(open.client, CHAT, fetchRuns);
    await new Promise((resolve) => setTimeout(resolve, 2));
    open.client.setQueryData(KEY, detail([{ ...run(RUN, 900), status: 'succeeded' } as Run]));
    waiting[0]?.(slice([run(RUN, 200)]));
    await settle();
    expect(cached(open.client)?.runs[0]?.status).toBe('succeeded');
    expect(waiting).toHaveLength(2);
    waiting[1]?.(slice([{ ...run(RUN, 950), status: 'succeeded' } as Run]));
    await settle();
    expect(cached(open.client)?.runs[0]?.usage?.contextUsed).toBe(950);
    open.close();
  });

  it('keeps a chat stale when it was closed and invalidated while the slice was read', async () => {
    const open = await openChat(detail([run(RUN, 100)]));
    const waiting: ((value: ConversationRuns) => void)[] = [];
    refreshChatRuns(
      open.client,
      CHAT,
      () => new Promise<ConversationRuns>((resolve) => waiting.push(resolve)),
    );
    open.close();
    await open.client.invalidateQueries({ queryKey: KEY, exact: true, refetchType: 'none' });
    waiting[0]?.(slice([run(RUN, 700)]));
    await settle();
    expect(cached(open.client)?.runs[0]?.usage?.contextUsed).toBe(100);
    expect(open.client.getQueryState(KEY)?.isInvalidated).toBe(true);
    expect(waiting).toHaveLength(1);
  });

  it('only marks a cached chat stale when nothing shows it', async () => {
    const open = await openChat(detail([run(RUN, 100)]));
    open.close();
    let asked = 0;
    refreshChatRuns(open.client, CHAT, () => {
      asked += 1;
      return Promise.resolve(slice([run(RUN, 700)]));
    });
    await settle();
    expect(asked).toBe(0);
    expect(open.fetches()).toBe(1);
    expect(open.client.getQueryState(KEY)?.isInvalidated).toBe(true);
  });

  it('does nothing for a chat that is not cached', async () => {
    const client = new QueryClient();
    let asked = 0;
    refreshChatRuns(client, CHAT, () => {
      asked += 1;
      return Promise.resolve(slice([]));
    });
    await settle();
    expect(asked).toBe(0);
    expect(client.getQueryState(KEY)).toBeUndefined();
  });

  it('falls back to refetching the detail when the slice cannot be read', async () => {
    const open = await openChat(detail([run(RUN, 100)]));
    open.serve(detail([run(RUN, 800)]));
    refreshChatRuns(open.client, CHAT, () => Promise.reject(new Error('offline')));
    await settle();
    expect(open.fetches()).toBe(2);
    expect(cached(open.client)?.runs[0]?.usage?.contextUsed).toBe(800);
    open.close();
  });
});
