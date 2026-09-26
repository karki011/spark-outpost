import { describe, expect, it } from 'vitest';
import {
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
  EventType,
  type Approval,
} from '@spark-outpost/contracts';
import { applyRunEvent, initialRunProjection } from '../run-projection.ts';
import { hasPending } from './approval-events.ts';

const approval: Approval = {
  id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  toolCallId: 'call_1',
  kind: 'execute',
  title: 'pnpm test',
  payload: { command: 'pnpm test', cwd: '/work', paths: [], diffs: [], truncated: false },
  payloadHash: 'sha256:abc',
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  status: 'pending',
  reason: null,
  decisionOptionId: null,
  scope: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-26T10:00:00.000Z',
};

describe('approval events in the live run', () => {
  it('adds a requested approval once and applies the decision', () => {
    let state = applyRunEvent(initialRunProjection, 1, {
      type: EventType.CUSTOM,
      name: APPROVAL_REQUESTED,
      value: approval,
    });
    state = applyRunEvent(state, 2, {
      type: EventType.CUSTOM,
      name: APPROVAL_REQUESTED,
      value: approval,
    });
    expect(state.approvals).toHaveLength(1);
    expect(hasPending(state.approvals)).toBe(true);
    state = applyRunEvent(state, 3, {
      type: EventType.CUSTOM,
      name: APPROVAL_DECIDED,
      value: {
        id: approval.id,
        status: 'allowed',
        decisionOptionId: 'allow',
        scope: 'run',
        decidedBy: 'user',
        decidedAt: '2026-09-26T10:01:00.000Z',
      },
    });
    expect(state.approvals[0]).toMatchObject({ status: 'allowed', scope: 'run' });
    expect(hasPending(state.approvals)).toBe(false);
  });

  it('ignores malformed and unrelated custom events', () => {
    const state = applyRunEvent(initialRunProjection, 1, {
      type: EventType.CUSTOM,
      name: APPROVAL_REQUESTED,
      value: { id: 'nope' },
    });
    expect(state.approvals).toEqual([]);
    const other = applyRunEvent(state, 2, { type: EventType.CUSTOM, name: 'other', value: 1 });
    expect(other.approvals).toBe(state.approvals);
  });
});
