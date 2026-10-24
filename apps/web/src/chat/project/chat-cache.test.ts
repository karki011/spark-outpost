import { describe, expect, it } from 'vitest';
import type { Approval, ConversationDetail, Run } from '@spark-outpost/contracts';
import { chatIdle } from './chat-cache.ts';

const run = (status: Run['status']) => ({ id: 'r1', status, parentRunId: null }) as Run;

const detail = (
  status: Run['status'],
  extra: { waitingOn?: number; approvals?: Partial<Approval>[] } = {},
) =>
  ({
    conversation: {
      latestRun: { id: 'r1', status, step: null, provider: 'claude', waitingOn: extra.waitingOn },
    },
    runs: [run(status)],
    approvals: extra.approvals ?? [],
  }) as unknown as ConversationDetail;

describe('chatIdle', () => {
  it('is idle after the turn finished with nothing waiting', () => {
    expect(chatIdle(detail('succeeded'))).toBe(true);
  });

  it('is busy while a turn runs or is queued', () => {
    expect(chatIdle(detail('running'))).toBe(false);
    expect(chatIdle(detail('queued'))).toBe(false);
  });

  it('is busy while background sub-agents still work', () => {
    expect(chatIdle(detail('running', { waitingOn: 2 }))).toBe(false);
    expect(chatIdle(detail('succeeded', { waitingOn: 1 }))).toBe(false);
  });

  it('is busy while the agent waits on a card', () => {
    expect(chatIdle(detail('awaiting_approval'))).toBe(false);
    expect(chatIdle(detail('succeeded', { approvals: [{ status: 'pending' }] }))).toBe(false);
  });
});
