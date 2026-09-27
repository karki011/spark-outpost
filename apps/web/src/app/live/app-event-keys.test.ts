import { describe, expect, it } from 'vitest';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import type { AppEvent } from '@spark-outpost/contracts';
import { isLiveQueryKey, mergeInvalidations } from './app-event-keys.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

const cached: Record<string, QueryKey> = {
  list: ['conversations'],
  detailA: ['conversations', A],
  detailB: ['conversations', B],
  commandsA: ['conversations', A, 'agent-commands'],
  search: ['conversation-search', 'retry'],
  digest: ['home', 'digest'],
  spendToday: ['home', 'spend', 'today'],
  spendWeek: ['home', 'spend', 'week'],
  health: ['home', 'provider-health'],
  task: ['tasks', 'task-1'],
  auditA: ['audit', A, 'summary'],
  auditB: ['audit', B, 'summary'],
  outcome: ['outcome', RUN],
  analytics: ['analytics', 'overview', '7d', ''],
  usage: ['usage-summary'],
  setup: ['setup'],
};

async function invalidatedBy(...events: AppEvent[]): Promise<string[]> {
  const client = new QueryClient();
  for (const key of Object.values(cached)) client.setQueryData(key, 'cached');
  for (const invalidation of mergeInvalidations(events)) {
    await client.invalidateQueries(invalidation);
  }
  return Object.entries(cached)
    .filter(([, key]) => client.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();
}

const event = (kind: AppEvent['kind'], conversationId: string | null = A): AppEvent => ({
  kind,
  conversationId,
  runId: kind === 'run' || kind === 'outcome' ? RUN : null,
});

describe('app event invalidation', () => {
  it('a finished run refreshes the chat, the sidebar, Home spend and health, and its outcome', async () => {
    expect(await invalidatedBy(event('run'))).toEqual(
      [
        'analytics',
        'auditA',
        'detailA',
        'health',
        'list',
        'outcome',
        'spendToday',
        'spendWeek',
        'task',
        'usage',
      ].sort(),
    );
  });

  it('a digest status change refreshes the digest and its spend', async () => {
    expect(await invalidatedBy(event('digest', null))).toEqual([
      'digest',
      'spendToday',
      'spendWeek',
    ]);
  });

  it('a step refreshes the sidebar row, the open chat and its audit summary', async () => {
    expect(await invalidatedBy(event('step'))).toEqual(['auditA', 'detailA', 'list']);
  });

  it('an approval also refreshes tasks', async () => {
    expect(await invalidatedBy(event('approval'))).toEqual(['auditA', 'detailA', 'list', 'task']);
  });

  it('orchestration progress refreshes only that chat', async () => {
    expect(await invalidatedBy(event('orchestration', B))).toEqual(['detailB']);
  });

  it('a conversation change refreshes the list, search results and that chat', async () => {
    expect(await invalidatedBy(event('conversation'))).toEqual(['detailA', 'list', 'search']);
  });

  it('task changes without a chat leave every chat detail alone', async () => {
    expect(await invalidatedBy(event('task', null))).toEqual(['list', 'task']);
  });

  it('a recorded outcome refreshes that run outcome and analytics', async () => {
    expect(await invalidatedBy(event('outcome'))).toEqual(['analytics', 'outcome']);
  });

  it('merges a burst of events into one invalidation per key', () => {
    const once = mergeInvalidations([event('run')]);
    expect(mergeInvalidations([event('run'), event('run'), event('step')])).toHaveLength(
      once.length,
    );
  });

  it('marks only pushed query roots as live', () => {
    expect(isLiveQueryKey(['conversations', A])).toBe(true);
    expect(isLiveQueryKey(['home', 'digest'])).toBe(true);
    expect(isLiveQueryKey(['setup'])).toBe(false);
    expect(isLiveQueryKey(['projects'])).toBe(false);
  });
});
