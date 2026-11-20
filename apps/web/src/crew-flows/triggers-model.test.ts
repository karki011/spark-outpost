import { describe, expect, it } from 'vitest';
import type { PublishHold, TriggerEvent } from '@spark-outpost/contracts';
import {
  defaultTriggers,
  eventRow,
  holdLine,
  triggerProblem,
  triggersSummary,
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

describe('triggersSummary', () => {
  it('says off when nothing is on and lists the events that are', () => {
    expect(triggersSummary(null)).toBe('Off · no event starts this workflow');
    expect(triggersSummary({ ...defaultTriggers(), turnChanged: true, commit: true })).toBe(
      'On · runs when a turn changes files, a new commit',
    );
    expect(triggersSummary({ ...defaultTriggers(), chatStarted: true })).toBe(
      'On · runs when a chat starts',
    );
  });
});

describe('triggerProblem', () => {
  it('needs Before publish for a hold', () => {
    expect(triggerProblem({ ...defaultTriggers(), holdOnFindings: true })).toBe(
      'Holding a publish needs Before publish on.',
    );
    expect(
      triggerProblem({ ...defaultTriggers(), beforePublish: true, holdOnFindings: true }),
    ).toBeNull();
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
