import { describe, expect, it } from 'vitest';
import type { PublishHold, TriggerEvent } from '@spark-outpost/contracts';
import {
  branchProblem,
  defaultTriggers,
  eventRow,
  holdLine,
  matchingBranches,
  triggerLabels,
} from './triggers-model.ts';

const now = new Date(2026, 10, 14, 10, 0);

function event(extra: Partial<TriggerEvent>): TriggerEvent {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'turn_changed',
    conversationId: '00000000-0000-4000-8000-000000000002',
    chatTitle: 'Fix the divider',
    state: 'started',
    reason: null,
    detail: null,
    dueAt: new Date(2026, 10, 14, 9, 55).toISOString(),
    workflowRunId: null,
    updatedAt: new Date(2026, 10, 14, 9, 56).toISOString(),
    ...extra,
  };
}

describe('triggerLabels', () => {
  it('names each trigger that is on, in the order the tab lists them', () => {
    expect(triggerLabels(null)).toEqual([]);
    expect(triggerLabels(defaultTriggers())).toEqual([]);
    expect(
      triggerLabels({ ...defaultTriggers(), beforePublish: true, commit: true, chatStarted: true }),
    ).toEqual(['Chat starts', 'New commit', 'Before publish']);
  });
});

describe('branchProblem', () => {
  it('accepts globs a branch can match and names the ones it cannot', () => {
    expect(branchProblem('')).toBeNull();
    expect(branchProblem('spark/*, main release/**')).toBeNull();
    expect(branchProblem('spark/*, feat..ure')).toMatch(/^feat\.\.ure can never match a branch/);
    expect(branchProblem('-x /lead trail/ a:b')).toMatch(/^-x, \/lead, trail\/ and a:b can never/);
  });
});

describe('matchingBranches', () => {
  const branches = ['spark/a', 'spark/b', 'main', null, undefined, 'spark/a'];

  it('lists the chat branches a pattern matches now', () => {
    expect(matchingBranches('', branches)).toBe('Every branch.');
    expect(matchingBranches('spark/*', branches)).toBe('Matches now: spark/a, spark/b.');
    expect(matchingBranches('release/*', branches)).toBe(
      'No chat is on a matching branch right now.',
    );
    expect(matchingBranches('a..b', branches)).toBeNull();
  });

  it('counts the rest when many match', () => {
    const many = Array.from({ length: 6 }, (_, index) => `spark/${index}`);
    expect(matchingBranches('spark/*', many)).toBe(
      'Matches now: spark/0, spark/1, spark/2, spark/3 and 2 more.',
    );
  });
});

describe('eventRow', () => {
  it('names the event, its chat and why it did not start', () => {
    const row = eventRow(
      event({ state: 'skipped', reason: 'unchanged', kind: 'commit' }),
      now,
      'h23',
    );
    expect(row).toMatchObject({
      what: 'New commit',
      chat: 'Fix the divider',
      state: 'Skipped',
      tone: 'quiet',
      note: 'Nothing changed since the last run',
    });
  });

  it('shows when a waiting trigger starts', () => {
    const row = eventRow(event({ state: 'pending' }), now, 'h23');
    expect(row.when.startsWith('Starts ')).toBe(true);
    expect(row.tone).toBe('running');
  });
});

describe('holdLine', () => {
  const hold: PublishHold = {
    id: '00000000-0000-4000-8000-000000000003',
    conversationId: '00000000-0000-4000-8000-000000000002',
    chatTitle: 'Fix',
    workflowId: 'review',
    findings: 1,
    finished: true,
    state: 'open',
    createdAt: now.toISOString(),
  };

  it('counts findings, or says the review did not finish', () => {
    expect(holdLine(hold)).toBe('1 Critical or High finding');
    expect(holdLine({ ...hold, finished: false })).toBe('The review did not finish');
  });
});
