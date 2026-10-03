import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { outcome, shownOptions } from './approval-outcome.ts';

const pending: Approval = {
  id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  toolCallId: 'call_1',
  kind: 'execute',
  title: 'npm test',
  payload: { command: 'npm test', cwd: '/work', paths: [], diffs: [], truncated: false },
  payloadHash: 'sha256:abc',
  options: [
    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
    { optionId: 'always', name: "Yes, and don't ask again", kind: 'allow_always' },
    { optionId: 'no', name: 'No', kind: 'reject_once' },
    { optionId: 'never', name: "No, and don't ask again", kind: 'reject_always' },
  ],
  status: 'pending',
  reason: null,
  decisionOptionId: null,
  scope: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-26T10:00:00.000Z',
};

const decided = (change: Partial<Approval>): Approval => ({
  ...pending,
  decidedBy: 'user',
  decidedAt: '2026-09-26T10:01:00.000Z',
  ...change,
});

describe('approval outcome', () => {
  it("says Spark's policy blocked a call, never that you declined it", () => {
    const blocked = outcome(
      decided({ status: 'denied', decidedBy: 'policy', decisionOptionId: 'no', reason: 'x' }),
    );
    expect(blocked).toEqual({
      icon: 'no',
      label: "Spark's policy blocked it.",
      detail: "The command didn't run.",
    });
  });

  it("names the agent's option the user chose", () => {
    const always = outcome(
      decided({ status: 'allowed', decisionOptionId: 'always', scope: 'run' }),
    );
    expect(always).toEqual({
      icon: 'ok',
      label: "Chose: Yes, and don't ask again.",
      detail: 'Allowed for this run.',
    });
    const never = outcome(decided({ status: 'denied', decisionOptionId: 'never', scope: 'run' }));
    expect(never.label).toBe("Chose: No, and don't ask again.");
    expect(never.detail).toBe("The command didn't run. Rejected for the rest of this run.");
  });

  it('keeps the harness texts for the project allowlist and for decisions nobody made', () => {
    expect(
      outcome(decided({ status: 'allowed', decisionOptionId: 'yes', scope: 'project' })).label,
    ).toBe('Always allowed in this project.');
    expect(
      outcome(decided({ status: 'allowed', decidedBy: 'allowlist', scope: 'once' })).label,
    ).toBe('Allowed once.');
    expect(outcome(decided({ status: 'expired', decidedBy: 'timeout' })).label).toBe('Expired.');
  });

  it('says which exit-plan option approved the plan', () => {
    const plan = decided({
      status: 'allowed',
      decisionOptionId: 'yes',
      scope: 'once',
      payload: { ...pending.payload, command: null, plan: '# Plan' },
    });
    expect(outcome(plan)).toEqual({
      icon: 'ok',
      label: 'Plan approved.',
      detail: 'Chose: Yes. Saved as the agreed plan.',
    });
  });

  it('hides the always-allow option when the action always asks', () => {
    const always = { ...pending, reason: 'Pushing always asks' };
    expect(shownOptions(always).map((option) => option.optionId)).toEqual(['yes', 'no', 'never']);
    expect(shownOptions(pending)).toHaveLength(4);
  });

  it('shows what Spark did for a Spark action, or why it failed', () => {
    const spark = (result: NonNullable<Approval['payload']['sparkResult']>, by = 'user' as const) =>
      outcome(
        decided({
          status: 'allowed',
          decidedBy: by,
          decisionOptionId: 'confirm',
          scope: 'once',
          payload: { ...pending.payload, sparkResult: result },
        }),
      );
    expect(spark({ state: 'running', message: null, url: null })).toMatchObject({
      label: 'Confirmed. Spark is doing it…',
    });
    expect(
      spark({ state: 'done', message: 'Opened PR #3.', url: 'https://github.com/o/r/pull/3' }),
    ).toMatchObject({ icon: 'ok', label: 'Opened PR #3.' });
    expect(
      outcome(
        decided({
          status: 'allowed',
          decidedBy: 'level',
          payload: {
            ...pending.payload,
            sparkResult: { state: 'done', message: 'Created ENG-1.', url: null },
          },
        }),
      ).detail,
    ).toContain('Done without a card');
    expect(spark({ state: 'failed', message: 'GitHub said no.', url: null })).toEqual({
      icon: 'no',
      label: 'It failed.',
      detail: 'GitHub said no.',
    });
  });
});
