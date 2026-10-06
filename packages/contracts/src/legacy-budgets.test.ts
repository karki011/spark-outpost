import { describe, expect, it } from 'vitest';
import { approvalSchema } from './approvals.ts';
import { orchestrationSchema } from './orchestration.ts';

const RUN = '00000000-0000-4000-8000-0000000000a1';

const oldBudgetCard = {
  id: '00000000-0000-4000-8000-0000000000c1',
  runId: RUN,
  toolCallId: 'checkpoint:budget:1',
  kind: 'budget',
  title: 'Continue past the budget?',
  payload: {
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    truncated: false,
    checkpoint: {
      kind: 'budget',
      question: 'Continue past the budget?',
      reason: 'The tool calls budget ran out.',
      budget: { limit: 'tool_calls', used: 60, allowed: 60 },
    },
  },
  payloadHash: 'sha256:old',
  options: [
    { optionId: 'continue', name: 'Continue', kind: 'allow_once' },
    { optionId: 'stop', name: 'Stop', kind: 'reject_once' },
  ],
  status: 'allowed',
  reason: 'The tool calls budget ran out.',
  decisionOptionId: 'continue',
  scope: 'once',
  decidedBy: 'user',
  decidedAt: '2026-10-01T10:00:05.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
};

const oldOrchestration = {
  runId: RUN,
  conversationId: '00000000-0000-4000-8000-0000000000b1',
  taskId: null,
  status: 'succeeded',
  phase: 'finished',
  depth: 'execute',
  depthSource: 'rules',
  risk: 'edits',
  level: 'hands-off',
  routing: 'auto',
  provider: 'claude',
  planVersion: null,
  retries: 0,
  maxRetries: 2,
  crew: [],
  checkpoints: [oldBudgetCard],
  pendingCheckpoint: null,
  decisions: [],
  budget: {
    activeMs: 90_000,
    activeLimitMs: 900_000,
    toolCalls: 60,
    toolCallLimit: 60,
    costUsd: 0.4,
    costCapUsd: null,
    exceeded: 'tool_calls',
  },
  totals: {
    runs: 0,
    tokens: 0,
    costUsd: 0,
    costSource: null,
    durationMs: 0,
    toolCalls: 0,
    jevCalls: 0,
    jevTokens: 0,
    jevCostUsd: 0,
    byRole: [],
    byModel: [],
  },
  error: null,
  updatedAt: '2026-10-01T10:00:10.000Z',
};

describe('records saved while runs had budgets', () => {
  it('reads an old budget card without its limit', () => {
    const card = approvalSchema.parse(oldBudgetCard);
    expect(card.kind).toBe('budget');
    expect(card.payload.checkpoint).not.toHaveProperty('budget');
  });

  it('reads an old run snapshot and drops its limits', () => {
    const snapshot = orchestrationSchema.parse(oldOrchestration);
    expect(snapshot).not.toHaveProperty('budget');
    expect(snapshot.usage).toBeUndefined();
    expect(snapshot.checkpoints).toHaveLength(1);
  });
});
