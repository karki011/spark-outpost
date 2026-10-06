import { describe, expect, it } from 'vitest';
import { checkpointPayloadSchema, type Approval } from '@spark-outpost/contracts';
import { approvalSummary, checkpointSummary, summaryText } from './pending-summary.ts';

function approval(
  patch: Omit<Partial<Approval>, 'payload'> & { payload?: Partial<Approval['payload']> },
): Approval {
  return {
    id: '00000000-0000-4000-8000-0000000000d2',
    runId: '00000000-0000-4000-8000-000000000001',
    toolCallId: 'call_1',
    kind: 'execute',
    title: 'x',
    payloadHash: 'sha256:abc',
    options: [],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-26T10:01:00.000Z',
    ...patch,
    payload: { command: null, cwd: null, paths: [], diffs: [], truncated: false, ...patch.payload },
  };
}

const checkpoint = (patch: Record<string, unknown>) =>
  checkpointPayloadSchema.parse({ question: 'Q', reason: 'R', ...patch });

describe('what is waiting for you', () => {
  it('names the command to approve, cut short, with the full text kept', () => {
    const summary = approvalSummary(
      approval({ payload: { command: "git grep -l -i 'AI_USER' -- apps packages" } }),
      'Run a command?',
    );
    expect(summaryText(summary)).toBe("approve git grep -l -i 'AI_USER' …");
    expect(summary.code).toBe(true);
    expect(summary.full).toBe("git grep -l -i 'AI_USER' -- apps packages");
  });

  it('names the file to edit and how many more', () => {
    const one = approval({ kind: 'edit', payload: { paths: ['/work/app/src/types.ts'] } });
    expect(summaryText(approvalSummary(one, 'Change a file?'))).toBe('approve edit types.ts');
    const three = approval({ kind: 'edit', payload: { paths: ['a/x.ts', 'b/y.ts', 'c/z.ts'] } });
    expect(summaryText(approvalSummary(three, 'Change these files?'))).toBe('approve edit x.ts +2');
  });

  it('calls a plan a plan to review', () => {
    const plan = approval({ kind: 'plan', payload: { plan: '1. Do it' } });
    expect(summaryText(approvalSummary(plan, 'Approve the plan?'))).toBe('plan to review');
    expect(summaryText(checkpointSummary(checkpoint({ kind: 'plan' }), 'Approve the plan?'))).toBe(
      'plan to review',
    );
  });

  it('quotes the question, and counts the rest', () => {
    const one = checkpoint({ kind: 'clarify', question: 'Which repo?' });
    expect(summaryText(checkpointSummary(one, 'Jev has a question'))).toBe('question: Which repo?');
    const many = checkpoint({
      kind: 'clarify',
      questions: [
        { question: 'Which report?', options: [], default: 'Spend' },
        { question: 'Which period?', options: [], default: 'This month' },
      ],
    });
    expect(summaryText(checkpointSummary(many, 'Spark has a few questions'))).toBe(
      'questions: Which report? +1',
    );
  });

  it('falls back to the card title for everything else', () => {
    expect(
      summaryText(checkpointSummary(checkpoint({ kind: 'retry' }), 'Retry one tier up?')),
    ).toBe('Retry one tier up?');
    expect(summaryText(approvalSummary(approval({ kind: 'other' }), 'Allow this action?'))).toBe(
      'Allow this action?',
    );
  });
});
