import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  MAX_REPAIR_RETRIES,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { openEntries } from './plan-progress.ts';
import {
  continueFollowUp,
  incompleteLine,
  initialFlow,
  nextStep,
  type FlowEvent,
  type FlowResult,
  type FlowState,
} from './transitions.ts';

function run(state: FlowState, events: readonly FlowEvent[]): FlowResult[] {
  const results: FlowResult[] = [];
  let current = state;
  for (const event of events) {
    const result = nextStep(current, event);
    results.push(result);
    current = result.state;
  }
  return results;
}

const built = (extra: Partial<Extract<FlowEvent, { type: 'agent_done' }>> = {}): FlowEvent => ({
  type: 'agent_done',
  role: 'builder',
  outcome: 'succeeded',
  ...extra,
});

const flow = (level: InvolvementLevel = 'hands-off', review = false) =>
  initialFlow('edits', level, review);

describe('lean flow', () => {
  it('answers a question with one in-place Scout and finishes', () => {
    const [start, done] = run(flow(), [
      { type: 'start', start: 'answer' },
      { type: 'agent_done', role: 'scout', outcome: 'succeeded' },
    ]);
    expect(start!.action).toMatchObject({ type: 'spawn', role: 'scout' });
    expect(start!.state.depth).toBe('direct');
    expect(done!.action).toMatchObject({ type: 'finish', status: 'succeeded' });
  });

  it('keeps by itself without a keep card at Auto-edit when the checks pass', () => {
    const [, , wrapped, kept] = run(flow('hands-off'), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'wrapped', filesChanged: 2 },
      { type: 'kept' },
    ]);
    expect(wrapped!.action).toEqual({ type: 'keep' });
    expect(kept!.action).toMatchObject({ type: 'finish', status: 'succeeded' });
  });

  it('keeps at Automatic with a note when the checks still fail', () => {
    const [, , wrapped] = run(flow('hands-off'), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'wrapped', filesChanged: 2, checksFailing: true, outsideWorktree: true },
    ]);
    expect(wrapped!.action).toEqual({
      type: 'keep',
      note: 'Kept automatically; worth a look: the checks still fail. Revert undoes them.',
    });
  });

  it('asks to keep at Automatic only for a destructive migration outside a worktree', () => {
    const wrappedAt = (outsideWorktree: boolean) =>
      run(flow('hands-off'), [
        { type: 'start', start: 'build' },
        built(),
        { type: 'wrapped', filesChanged: 1, riskyMigration: 'DROP TABLE notes', outsideWorktree },
      ]).at(-1)!;
    expect(wrappedAt(false).action).toMatchObject({ type: 'keep' });
    expect(wrappedAt(true).action).toMatchObject({ type: 'ask' });
    expect(wrappedAt(true).state.waitingFor).toBe('accept');
  });

  it('retries a failed Critic once, then skips the review quietly and keeps', () => {
    const steps = run(flow('hands-off', true), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'agent_done', role: 'critic', outcome: 'failed', error: 'internal error' },
      { type: 'agent_done', role: 'critic', outcome: 'failed', error: 'internal error' },
      { type: 'wrapped', filesChanged: 1 },
    ]);
    expect(steps[2]!.action).toMatchObject({ type: 'spawn', role: 'critic', reason: 'retry' });
    expect(steps[3]!.action).toEqual({ type: 'wrap_up' });
    expect(steps[3]!.state.criticSkipped).toBe('internal error');
    expect(steps[4]!.action).toEqual({
      type: 'keep',
      note: 'Kept automatically; worth a look: the Critic was unavailable, so no AI review ran. Revert undoes them.',
    });
  });

  it('uses the retried Critic’s verdict when the retry succeeds', () => {
    const steps = run(flow('hands-off', true), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'agent_done', role: 'critic', outcome: 'failed', error: 'internal error' },
      { type: 'agent_done', role: 'critic', outcome: 'succeeded', verdict: 'looks_good' },
      { type: 'wrapped', filesChanged: 1 },
    ]);
    expect(steps[3]!.state).toMatchObject({ verdict: 'looks_good', criticRetried: true });
    expect(steps[3]!.state.criticSkipped).toBeUndefined();
    expect(steps[4]!.action).toEqual({ type: 'keep' });
  });

  it('keeps by itself at Automatic after a clean Critic, and with a note after an unclear one', () => {
    const reviewed = (verdict: 'looks_good' | 'unclear') =>
      run(flow('hands-off', true), [
        { type: 'start', start: 'build' },
        built(),
        { type: 'agent_done', role: 'critic', outcome: 'succeeded', verdict },
        { type: 'wrapped', filesChanged: 1 },
      ]).at(-1)!.action;
    expect(reviewed('looks_good')).toEqual({ type: 'keep' });
    expect(reviewed('unclear')).toEqual({
      type: 'keep',
      note: 'Kept automatically; worth a look: the Critic still has concerns. Revert undoes them.',
    });
  });

  it('runs one Critic only for destructive work, a review request or a large diff', () => {
    const destructive = run(initialFlow('destructive', 'hands-off'), [
      { type: 'start', start: 'build' },
      built(),
    ]);
    expect(destructive[1]!.action).toMatchObject({ type: 'spawn', role: 'critic' });
    const review = run(flow('hands-off', true), [{ type: 'start', start: 'build' }, built()]);
    expect(review[1]!.action).toMatchObject({ type: 'spawn', role: 'critic' });
    const large = run(flow(), [{ type: 'start', start: 'build' }, built({ large: true })]);
    expect(large[1]!.action).toMatchObject({ type: 'spawn', role: 'critic' });
    const small = run(flow(), [{ type: 'start', start: 'build' }, built({ large: false })]);
    expect(small[1]!.action).toEqual({ type: 'wrap_up' });
  });

  it('skips the Critic when the Builder changed no files, even for destructive work (B7)', () => {
    const refused = run(initialFlow('destructive', 'hands-off'), [
      { type: 'start', start: 'build' },
      built({ unchanged: true }),
    ]);
    expect(refused[1]!.action).toEqual({ type: 'wrap_up' });
    const review = run(flow('hands-off', true), [
      { type: 'start', start: 'build' },
      built({ unchanged: true }),
    ]);
    expect(review[1]!.action).toEqual({ type: 'wrap_up' });
  });

  it('reviews once, then wraps up with the verdict', () => {
    const results = run(flow('hands-off', true), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'agent_done', role: 'critic', outcome: 'succeeded', verdict: 'concerns' },
    ]);
    expect(results[2]!.action).toEqual({ type: 'wrap_up' });
    expect(results[2]!.state.verdict).toBe('concerns');
  });
});

describe('destructive work', () => {
  it('builds straight away without a card', () => {
    const [start] = run(initialFlow('destructive', 'hands-off'), [
      { type: 'start', start: 'build' },
    ]);
    expect(start!.action).toMatchObject({ type: 'spawn', role: 'builder' });
  });
});

describe('plan completion', () => {
  it('continues the same Builder while its own plan has open items, at most twice', () => {
    const open = ['Add a test', 'Update the docs'];
    const results = run(flow('hands-off'), [
      { type: 'start', start: 'build' },
      built({ open }),
      built({ open }),
      built({ open }),
      { type: 'wrapped', filesChanged: 1 },
    ]);
    expect(results[1]!.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'continue',
      followUp: continueFollowUp(open),
    });
    expect(results[2]!.action).toMatchObject({ reason: 'continue' });
    expect(results[3]!.action).toEqual({ type: 'wrap_up' });
    expect(results[4]!.action).toEqual({ type: 'keep' });
    expect(nextStep(results[4]!.state, { type: 'kept' }).action).toMatchObject({
      type: 'finish',
      status: 'succeeded',
      incomplete: incompleteLine(open),
    });
  });

  it('never reports done while plan items are open', () => {
    expect(incompleteLine(['Add a test'])).toBe(
      'Incomplete: 1 plan item is still open: "Add a test". Ask to continue and the Builder picks up from there.',
    );
    expect(incompleteLine([])).toBeNull();
  });

  it('reads open items from the Builder’s own plan', () => {
    expect(
      openEntries([
        { content: 'Write it', priority: 'medium', status: 'completed' },
        { content: 'Test it', priority: 'medium', status: 'in_progress' },
        { content: 'Ship it', priority: 'low', status: 'pending' },
      ]),
    ).toEqual(['Test it', 'Ship it']);
  });
});

describe('failures and retries', () => {
  it('retries a failed Builder one tier up by rule, then asks with Stop and report', () => {
    const failed = built({ outcome: 'failed', error: 'boom' });
    const events: FlowEvent[] = [{ type: 'start', start: 'build' }];
    for (let index = 0; index <= MAX_REPAIR_RETRIES; index += 1) events.push(failed);
    const results = run(flow(), events);
    expect(results[1]!.action).toMatchObject({ reason: 'retry', escalate: true });
    expect(results.at(-1)!.action).toEqual({
      type: 'finish',
      status: 'succeeded',
      reason: null,
      incomplete: `Needs you: Stopped after ${MAX_REPAIR_RETRIES} retries.`,
    });
  });

  it('reruns a passing build Jev could not confirm one tier up instead of stopping it', () => {
    for (const level of ['hands-off', 'full-auto'] as const) {
      const results = run(initialFlow('edits', level, false, true), [
        { type: 'start', start: 'build' },
        built({ green: true }),
        {
          type: 'verified',
          accepted: 'unsupported',
          reasons: [],
          evidence: { checksPass: true, criticConcerns: false, confidentUnmet: true },
        },
      ]);
      expect(results[1]!.action).toEqual({ type: 'verify' });
      expect(results[2]!.action).toMatchObject({
        type: 'spawn',
        role: 'builder',
        reason: 'escalate',
        escalate: true,
      });
    }
  });

  it('stops with a report when the Builder loops', () => {
    const looped: FlowEvent = {
      type: 'looped',
      summary: 'Bolt repeated `Read a.ts` 5 times in a row',
    };
    for (const level of ['hands-off', 'full-auto'] as const) {
      const results = run(flow(level), [{ type: 'start', start: 'build' }, looped]);
      expect(results[1]!.action).toMatchObject({
        type: 'finish',
        status: 'failed',
        reason: 'Stopped: Bolt repeated `Read a.ts` 5 times in a row.',
      });
    }
  });
});

describe('checkpoints', () => {
  it('keeps, fixes or reverts from the keep card', () => {
    const [, , wrapped] = run(flow(), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'wrapped', filesChanged: 1 },
    ]);
    const answer = (optionId: string, note: string | null = null) =>
      nextStep(wrapped!.state, { type: 'answered', optionId, note }).action;
    expect(answer(CHECKPOINT_OPTION.keep)).toMatchObject({ type: 'finish', status: 'succeeded' });
    expect(answer(CHECKPOINT_OPTION.revert)).toEqual({ type: 'revert' });
    expect(answer(CHECKPOINT_OPTION.fix, 'Use UTC')).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'fix',
      note: 'Use UTC',
    });
  });

  it('stops on Stop', () => {
    const [, stopped] = run(flow(), [{ type: 'start', start: 'build' }, { type: 'stopped' }]);
    expect(stopped!.action).toMatchObject({ type: 'finish', status: 'cancelled' });
  });
});

describe('read-only work: a review of existing changes', () => {
  it('reviews existing changes with the Critic alone and never sends findings to a Builder (dev-day s07)', () => {
    const [start, reviewed] = run(flow(), [
      { type: 'start', start: 'review' },
      {
        type: 'agent_done',
        role: 'critic',
        outcome: 'succeeded',
        verdict: 'concerns',
        fixable: ['plural() is wrong for 0'],
      },
    ]);
    expect(start!.action).toMatchObject({ type: 'spawn', role: 'critic', reason: 'first' });
    expect(start!.state).toMatchObject({ depth: 'direct', readOnly: 'review', reviewed: true });
    expect(reviewed!.action).toMatchObject({ type: 'finish', status: 'succeeded' });
    expect(reviewed!.state.verdict).toBe('concerns');
  });
});
