import { describe, expect, it } from 'vitest';
import type { ConversationAttention, ConversationSummary } from '@spark-outpost/contracts';
import { attention, attentionLine, rowState } from './row-state.ts';

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Chat',
    updatedAt: '2026-09-26T10:00:00.000Z',
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...overrides,
  };
}

const run = (status: string, extra: { error?: string | null; step?: string | null } = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000002',
    status,
    error: extra.error ?? null,
    step: extra.step ?? null,
  }) as ConversationSummary['latestRun'];

describe('rowState', () => {
  it('asks for input before anything else', () => {
    expect(rowState(chat({ needsInput: true, latestRun: run('running') }), false)).toMatchObject({
      tone: 'asking',
      sub: 'Needs your input',
    });
  });

  it('shows the running step, or a starting hint', () => {
    expect(rowState(chat({ latestRun: run('queued') }), false).sub).toBe('Starting');
    expect(rowState(chat({ latestRun: run('running', { step: 'Reading files' }) }), false)).toEqual(
      { tone: 'running', label: 'Running', sub: 'Reading files' },
    );
  });

  it('marks a finished reply until the chat is open', () => {
    const finished = chat({ unread: true, latestRun: run('succeeded') });
    expect(rowState(finished, false)).toMatchObject({
      tone: 'done',
      sub: 'Finished · open to review',
    });
    expect(rowState(finished, true).tone).toBe('idle');
    expect(rowState(chat({ latestRun: run('succeeded') }), false).tone).toBe('idle');
  });

  it('explains why a run stopped', () => {
    expect(
      rowState(chat({ latestRun: run('failed', { error: 'Rate limit reached.' }) }), false),
    ).toMatchObject({ tone: 'error', sub: 'Stopped: rate limit reached' });
    expect(rowState(chat({ latestRun: run('failed') }), false).sub).toBe('Stopped with an error');
    expect(rowState(chat({ latestRun: run('outcome_unknown') }), false).tone).toBe('error');
    expect(rowState(chat({ latestRun: run('cancelled') }), false).tone).toBe('idle');
  });
});

const APPROVAL = '00000000-0000-4000-8000-0000000000a1';

function ask(overrides: Partial<ConversationAttention>): ConversationAttention {
  return {
    kind: 'input',
    title: '',
    agentName: null,
    provider: 'claude',
    approvalId: APPROVAL,
    ...overrides,
  };
}

describe('attentionLine', () => {
  it('says who wants permission for what', () => {
    expect(
      attentionLine(ask({ kind: 'permission', title: 'run pnpm test', agentName: 'Bolt' })),
    ).toBe('Bolt wants to run pnpm test');
    expect(attentionLine(ask({ kind: 'permission', title: 'edit format.ts' }))).toBe(
      'Claude wants to edit format.ts',
    );
    expect(attentionLine(ask({ kind: 'permission', title: 'edit a.ts', provider: null }))).toBe(
      'The agent wants to edit a.ts',
    );
  });

  it('names the plan, the review, and the question', () => {
    expect(attentionLine(ask({ kind: 'plan', agentName: 'Sketch' }))).toBe(
      'Sketch’s plan is ready for review',
    );
    expect(attentionLine(ask({ kind: 'plan' }))).toBe('The plan is ready for review');
    expect(attentionLine(ask({ kind: 'review', agentName: 'Bolt' }))).toBe(
      'Bolt’s changes are ready to review',
    );
    expect(attentionLine(ask({ kind: 'review' }))).toBe('Changes are ready to review');
    expect(attentionLine(ask({ agentName: 'Jev', title: 'Which heading?' }))).toBe(
      'Jev has a question',
    );
    expect(attentionLine(ask({ title: 'Continue past the budget?' }))).toBe(
      'Continue past the budget?',
    );
    expect(attentionLine(ask({}))).toBe('Needs your input');
    expect(attentionLine(null)).toBe('Needs your input');
  });
});

describe('rowState while waiting', () => {
  it('uses a permission tone for tool approvals and an input tone for the rest', () => {
    const permission = chat({
      needsInput: true,
      attention: ask({ kind: 'permission', title: 'run pnpm test', agentName: 'Bolt' }),
    });
    expect(rowState(permission, false)).toEqual({
      tone: 'permission',
      label: 'Asking permission',
      sub: 'Bolt wants to run pnpm test',
    });
    const plan = chat({ needsInput: true, attention: ask({ kind: 'plan', agentName: 'Sketch' }) });
    expect(rowState(plan, true)).toEqual({
      tone: 'asking',
      label: 'Needs your input',
      sub: 'Sketch’s plan is ready for review',
    });
  });
});

describe('attention', () => {
  const asking = (id: string, title: string, extra: Partial<ConversationSummary> = {}) =>
    chat({ id, title, needsInput: true, ...extra });

  it('lists the waiting chats other than the open one', () => {
    const first = asking('00000000-0000-4000-8000-00000000000a', 'Deploy');
    const second = asking('00000000-0000-4000-8000-00000000000b', 'Migrate', {
      attention: ask({ kind: 'permission', title: 'run ls' }),
    });
    const third = asking('00000000-0000-4000-8000-00000000000c', 'Docs');
    expect(attention([first], null)).toMatchObject({ count: 1, text: 'Deploy needs your input' });
    expect(attention([first], first.id)).toEqual({ count: 1, others: [], text: null });
    expect(attention([first, second], first.id)).toEqual({
      count: 2,
      others: [second],
      text: 'Migrate needs your permission',
    });
    expect(attention([first, second, third], null)).toMatchObject({
      count: 3,
      text: '3 chats need you',
    });
    expect(attention([{ ...first, archivedAt: '2026-09-26T00:00:00.000Z' }], null).count).toBe(0);
  });
});
