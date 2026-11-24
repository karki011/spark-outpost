import { describe, expect, it } from 'vitest';
import type { ConversationDetail, Run } from '@spark-outpost/contracts';
import { sameTurnDetail } from './turn-props.ts';

const run = (id: string, extra: Partial<Run> = {}) => ({ id, parentRunId: null, ...extra }) as Run;

function detail(runs: Run[], activity: ConversationDetail['activity']): ConversationDetail {
  return {
    runs,
    activity,
    messages: [],
    approvals: [],
    tasks: [],
    orchestrations: {},
  } as unknown as ConversationDetail;
}

describe('turn detail comparison', () => {
  const old = run('old');
  const live = run('live');
  const steps = [{ name: 'Read a file', done: true }];
  const before = detail([old, live], { old: steps, live: [] });
  const shared = before.runs;

  it('lets a finished turn skip a refresh that only touched the live turn', () => {
    const after = {
      ...before,
      runs: [old, run('live', { status: 'running' })],
      activity: { old: steps, live: [{ name: 'Edit a file', done: false }] },
    };
    expect(sameTurnDetail(before, after, old)).toBe(true);
    expect(sameTurnDetail(before, after, live)).toBe(false);
  });

  it('re-renders every turn when shared data or the latest turn changes', () => {
    expect(sameTurnDetail(before, { ...before, messages: [] }, old)).toBe(false);
    const newer = { ...before, runs: [...shared, run('next')] };
    expect(sameTurnDetail(before, newer, old)).toBe(false);
  });

  it('skips a step label patch on the chat row', () => {
    const chat = { id: 'c', title: 'Chat', latestRun: { id: 'live', step: 'Reading' } };
    const first = { ...before, conversation: chat } as unknown as ConversationDetail;
    const patched = {
      ...first,
      conversation: { ...chat, latestRun: { id: 'live', step: 'Editing' } },
    } as unknown as ConversationDetail;
    expect(sameTurnDetail(first, patched, old)).toBe(true);
    expect(sameTurnDetail(first, patched, live)).toBe(true);
    const renamed = { ...first, conversation: { ...chat, title: 'Renamed' } };
    expect(sameTurnDetail(first, renamed as unknown as ConversationDetail, old)).toBe(false);
  });

  it('re-renders only the turn whose cards, commands or task changed', () => {
    const card = (id: string, runId: string) => ({ id, runId });
    const kept = card('a1', 'old');
    const first = { ...before, approvals: [kept] } as unknown as ConversationDetail;
    const asked = {
      ...first,
      approvals: [kept, card('a2', 'live')],
    } as unknown as ConversationDetail;
    expect(sameTurnDetail(first, asked, old)).toBe(true);
    expect(sameTurnDetail(first, asked, live)).toBe(false);
    const answered = { ...first, approvals: [{ ...kept }] } as unknown as ConversationDetail;
    expect(sameTurnDetail(first, answered, old)).toBe(false);
    const ran = { ...first, commands: [card('c1', 'live')] } as unknown as ConversationDetail;
    expect(sameTurnDetail(first, ran, old)).toBe(true);
    expect(sameTurnDetail(first, ran, live)).toBe(false);
    const task = {
      ...first,
      tasks: [{ id: 't1', runIds: ['live'] }],
    } as unknown as ConversationDetail;
    expect(sameTurnDetail(first, task, old)).toBe(true);
    expect(sameTurnDetail(first, task, live)).toBe(false);
  });

  it('counts a card on a run started under the turn', () => {
    const nested = run('nested', { parentRunId: 'old' });
    const first = { ...before, runs: [old, live, nested] } as unknown as ConversationDetail;
    const asked = { ...first, approvals: [{ id: 'a3', runId: 'nested' }] };
    expect(sameTurnDetail(first, asked as unknown as ConversationDetail, old)).toBe(false);
    expect(sameTurnDetail(first, asked as unknown as ConversationDetail, live)).toBe(true);
  });
});
