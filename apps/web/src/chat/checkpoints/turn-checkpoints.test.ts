import { describe, expect, it } from 'vitest';
import type { Approval, ConversationDetail } from '@spark-outpost/contracts';
import { turnCheckpoints } from './turn-checkpoints.ts';

function approval(
  id: string,
  runId: string,
  kind: Approval['kind'],
  checkpoint: boolean,
): Approval {
  return {
    id,
    runId,
    kind,
    status: 'allowed',
    decidedBy: 'level',
    decisionOptionId: 'keep',
    createdAt: `2026-10-10T10:00:0${id.length}.000Z`,
    payload: checkpoint ? { checkpoint: { kind: 'accept' } } : {},
  } as unknown as Approval;
}

function detail(approvals: Approval[], orchestrations: Record<string, unknown> = {}) {
  return { approvals, orchestrations } as unknown as ConversationDetail;
}

describe('the checkpoints of a turn', () => {
  it('reads the kept record of a run with no orchestration from the chat approvals', () => {
    const kept = approval('a', 'run-1', 'accept', true);
    const found = turnCheckpoints(
      'run-1',
      detail([
        kept,
        approval('bb', 'run-2', 'accept', true),
        approval('ccc', 'run-1', 'edit', false),
      ]),
    );
    expect(found.map((item) => item.id)).toEqual(['a']);
  });

  it('reads a stored crew turn from its orchestration and never twice', () => {
    const kept = approval('a', 'run-1', 'accept', true);
    const found = turnCheckpoints('run-1', detail([kept], { 'run-1': { checkpoints: [kept] } }));
    expect(found.map((item) => item.id)).toEqual(['a']);
  });

  it('has none for a turn that kept nothing', () => {
    expect(turnCheckpoints('run-1', detail([]))).toEqual([]);
  });
});
