import { describe, expect, it } from 'vitest';
import {
  composeUpdate,
  pickUpdate,
  updatePlan,
  updateQuestions,
  type ChatFacts,
} from './update-summary.ts';

const base: ChatFacts = {
  title: 'Fix image uploads',
  state: 'running',
  phase: 'building',
  step: 'Editing upload.ts',
  agent: { name: 'Bolt', role: 'Builder' },
  steps: { done: 3, total: 5 },
  files: ['apps/server/upload.ts', 'apps/server/resize.ts', 'a.test.ts', 'b.test.ts'],
  checks: null,
  costUsd: 0.31,
  waitingOn: null,
  error: null,
  quietMinutes: 1,
};

describe('chat update summary', () => {
  it('writes three plain lines from what Spark tracks', () => {
    const plan = updatePlan(base);
    expect(composeUpdate(base, pickUpdate(plan, null))).toEqual([
      'On track. 3 of 5 steps done. Bolt is editing upload.ts.',
      'Changed 4 files (upload.ts, resize.ts and 2 more); checks haven’t run yet · $0.31 so far.',
      'Next: finish editing upload.ts.',
    ]);
  });

  it('calls a long-quiet run stuck and a finished one done', () => {
    const quiet = { ...base, quietMinutes: 25 };
    expect(updatePlan(quiet).rules.headline).toBe('stuck');
    const done = {
      ...base,
      state: 'succeeded' as const,
      checks: { status: 'passed' as const, failing: 0 },
      files: ['docs/notes.md'],
    };
    expect(composeUpdate(done, pickUpdate(updatePlan(done), null))).toEqual([
      'Done. 3 of 5 steps done.',
      'Changed 1 file (notes.md); checks passed · $0.31.',
      'Next: look over the changes in Spark.',
    ]);
  });

  it('explains a failure and points at retry', () => {
    const failed = {
      ...base,
      state: 'failed' as const,
      error: 'Two tests failed in upload.test.ts.',
    };
    const lines = composeUpdate(failed, pickUpdate(updatePlan(failed), null));
    expect(lines[0]).toBe('Couldn’t finish. Two tests failed in upload.test.ts.');
    expect(lines.at(-1)).toBe('Next: retry, or open the chat to see what went wrong.');
  });

  it('only offers Jev the options that fit and redacts what it sends', () => {
    const plan = updatePlan({ ...base, checks: { status: 'failed', failing: 2 } });
    expect(plan.next[0]).toBe('fix_checks');
    const asked = updateQuestions(
      { ...base, title: 'Rotate key sk-ant-api03-abcdefghijklmnop' },
      plan,
    );
    expect(Object.keys(asked.questions)).toEqual(['update_state', 'update_next']);
    expect(JSON.stringify(asked.state)).not.toContain('abcdefghijklmnop');
  });
});
