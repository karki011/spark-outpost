import { describe, expect, it } from 'vitest';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import type { AppEvent } from '@spark-outpost/contracts';
import { isLiveQueryKey, isStepEvent, mergeInvalidations } from './app-event-keys.ts';

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
  today: ['home', 'today'],
  task: ['tasks', 'task-1'],
  changesA: ['tasks', 'change-summaries', 'task-1'],
  changeFiles: ['tasks', 'task-1', 'changes', 'files', 'v1', '', '', 0],
  auditA: ['audit', A, 'summary'],
  auditB: ['audit', B, 'summary'],
  outcome: ['outcome', RUN],
  analytics: ['analytics', 'overview', '7d', ''],
  usage: ['usage-summary'],
  setup: ['setup'],
  mapProject: ['map', 'project', A],
  mapArea: ['map', 'area', A, 'aaaaaaaaaaaa', 120],
  ticketInbox: ['tickets', 'inbox'],
  ticketView: ['tickets', 'view', 'linear', 'ENG-1'],
  ticketConnections: ['tickets', 'connections'],
  previewA: ['preview', 'chat', A],
  previewB: ['preview', 'chat', B],
  previewProject: ['preview', 'project', A],
  outpostList: ['outposts', 'list'],
  outpostDetail: ['outposts', 'detail', A],
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
  it('a finished run refreshes the chat, the sidebar, Home spend, health and today, and its outcome', async () => {
    expect(await invalidatedBy(event('run'))).toEqual(
      [
        'analytics',
        'auditA',
        'changeFiles',
        'changesA',
        'detailA',
        'health',
        'list',
        'outcome',
        'outpostDetail',
        'outpostList',
        'previewA',
        'spendToday',
        'spendWeek',
        'task',
        'today',
        'usage',
      ].sort(),
    );
  });

  it('a preview server change refreshes every preview on screen and nothing else', async () => {
    expect(await invalidatedBy(event('preview', null))).toEqual([
      'previewA',
      'previewB',
      'previewProject',
    ]);
  });

  it('an outpost change refreshes the outposts and the sidebar list, where a chat carries its outpost', async () => {
    expect(await invalidatedBy(event('outpost_changed', null))).toEqual([
      'list',
      'outpostDetail',
      'outpostList',
    ]);
  });

  it('map progress refreshes every map on screen and nothing else', async () => {
    expect(await invalidatedBy(event('map', null))).toEqual(['mapArea', 'mapProject']);
  });

  it('a digest status change refreshes the digest and its spend', async () => {
    expect(await invalidatedBy(event('digest', null))).toEqual([
      'digest',
      'spendToday',
      'spendWeek',
    ]);
  });

  it('a step refreshes the sidebar row, the open chat, its audit summary and live change counts', async () => {
    expect(await invalidatedBy(event('step'))).toEqual(['auditA', 'changesA', 'detailA', 'list']);
  });

  it('a sub-agent starting or ending refreshes the sidebar row and the open chat, outside the step lane', async () => {
    expect(await invalidatedBy(event('subagent'))).toEqual(['auditA', 'detailA', 'list']);
    expect(isStepEvent(event('subagent'))).toBe(false);
  });

  it('an approval also refreshes tasks and the day so far', async () => {
    expect(await invalidatedBy(event('approval'))).toEqual([
      'auditA',
      'changeFiles',
      'changesA',
      'detailA',
      'list',
      'outpostDetail',
      'outpostList',
      'task',
      'today',
    ]);
  });

  it('orchestration progress refreshes only that chat', async () => {
    expect(await invalidatedBy(event('orchestration', B))).toEqual(['detailB']);
  });

  it('a conversation change refreshes the list, search results and that chat', async () => {
    expect(await invalidatedBy(event('conversation'))).toEqual([
      'detailA',
      'list',
      'previewA',
      'search',
    ]);
  });

  it('task changes without a chat leave every chat detail alone', async () => {
    expect(await invalidatedBy(event('task', null))).toEqual([
      'changeFiles',
      'changesA',
      'list',
      'task',
      'today',
    ]);
  });

  it('a recorded outcome refreshes that run outcome and analytics', async () => {
    expect(await invalidatedBy(event('outcome'))).toEqual(['analytics', 'outcome']);
  });

  it('a ticket attention change refreshes the inbox and connections but not a single ticket view', async () => {
    expect(await invalidatedBy(event('ticket', null))).toEqual([
      'ticketConnections',
      'ticketInbox',
    ]);
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
    expect(isLiveQueryKey(['tickets', 'inbox'])).toBe(true);
    expect(isLiveQueryKey(['setup'])).toBe(false);
    expect(isLiveQueryKey(['projects'])).toBe(false);
  });

  it('refetches only that chat’s terminal start phase when it changes', () => {
    const invalidations = mergeInvalidations([
      { kind: 'terminal_start', conversationId: A, runId: null },
    ]);
    expect(invalidations).toEqual([
      { queryKey: ['terminal-start', A], exact: true },
      { queryKey: ['native-terminal', A], exact: true },
    ]);
    expect(
      mergeInvalidations([{ kind: 'terminal_start', conversationId: null, runId: null }]),
    ).toEqual([]);
  });

  it('refetches the pause state when Spark is paused or resumed elsewhere', () => {
    expect(
      mergeInvalidations([{ kind: 'spark_pause', conversationId: null, runId: null }]),
    ).toEqual([{ queryKey: ['spark-pause'], exact: true }]);
  });
});
