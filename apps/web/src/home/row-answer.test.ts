import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { answeredChat, rowAnswer } from './row-answer.ts';

const QUICK = { allow: 'allow', deny: 'deny', payloadHash: 'sha256:abc' };
const APPROVAL = '00000000-0000-4000-8000-0000000000a1';

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    title: 'Deploy the site',
    needsInput: true,
    archivedAt: null,
    latestRun: { id: APPROVAL, status: 'awaiting_approval', error: null, step: null },
    attention: {
      kind: 'permission',
      title: 'run pnpm deploy',
      agentName: null,
      provider: 'claude',
      approvalId: APPROVAL,
      quick: QUICK,
    },
    ...overrides,
  } as ConversationSummary;
}

function attentionOf(patch: Record<string, unknown>) {
  return { ...chat().attention!, ...patch } as ConversationSummary['attention'];
}

describe('row answer', () => {
  it('answers an ordinary permission card the server marked plain', () => {
    expect(rowAnswer(chat())).toEqual({ approvalId: APPROVAL, ...QUICK });
  });

  it('offers nothing without the server mark', () => {
    expect(rowAnswer(chat({ attention: attentionOf({ quick: undefined }) }))).toBeNull();
  });

  it.each([
    ['a question', { kind: 'input' }],
    ['a plan', { kind: 'plan' }],
    ['a pull request follow-up', { prFeedback: true }],
    ['a card with no approval', { approvalId: null }],
  ])('offers nothing for %s', (_name, patch) => {
    expect(rowAnswer(chat({ attention: attentionOf(patch) }))).toBeNull();
  });

  it('offers nothing for an archived chat, a Terminal session or a chat no longer waiting', () => {
    expect(rowAnswer(chat({ archivedAt: '2026-11-10T10:00:00.000Z' }))).toBeNull();
    expect(rowAnswer(chat({ sessionType: 'terminal' }))).toBeNull();
    expect(rowAnswer(chat({ needsInput: false }))).toBeNull();
  });

  it('moves an answered chat on to running without its card', () => {
    const next = answeredChat(chat({ waitingSince: '2026-11-10T10:00:00.000Z' }));
    expect(next.needsInput).toBe(false);
    expect(next.attention).toBeNull();
    expect(next.waitingSince).toBeNull();
    expect(next.latestRun?.status).toBe('running');
  });
});
