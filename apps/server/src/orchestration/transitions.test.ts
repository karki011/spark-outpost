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

  it('asks to keep at Auto-edit when the checks still fail', () => {
    const [, , wrapped] = run(flow('hands-off'), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'wrapped', filesChanged: 2, checksFailing: true },
    ]);
    expect(wrapped!.action).toEqual({
      type: 'ask',
      kind: 'accept',
      reason: '2 files changed. Automatic asks because the checks still fail.',
    });
  });

  it('keeps by itself at Auto-edit after a clean Critic, and asks after an unclear one', () => {
    const reviewed = (verdict: 'looks_good' | 'unclear') =>
      run(flow('hands-off', true), [
        { type: 'start', start: 'build' },
        built(),
        { type: 'agent_done', role: 'critic', outcome: 'succeeded', verdict },
        { type: 'wrapped', filesChanged: 1 },
      ]).at(-1)!.action;
    expect(reviewed('looks_good')).toEqual({ type: 'keep' });
    expect(reviewed('unclear')).toMatchObject({ type: 'ask', kind: 'accept' });
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
    expect(results.at(-1)!.action).toMatchObject({ type: 'ask', kind: 'retry' });
  });

  it('stops and reports from the retry card instead of finishing', () => {
    const state = { ...flow(), retries: MAX_REPAIR_RETRIES };
    const result = nextStep(state, {
      type: 'answered',
      kind: 'retry',
      optionId: CHECKPOINT_OPTION.stopReport,
      note: null,
    });
    expect(result.action).toMatchObject({ type: 'finish', status: 'failed' });
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
  it('asks one question for a vague follow-up, and answers, plans or builds from the reply', () => {
    const [ask] = run(flow(), [{ type: 'unclear', followUp: true }]);
    expect(ask!.action).toMatchObject({ type: 'ask', kind: 'clarify', followUp: true });
    expect(nextStep(ask!.state, { type: 'clarified', start: 'answer' }).action).toMatchObject({
      role: 'scout',
    });
    expect(nextStep(ask!.state, { type: 'clarified', start: 'plan' }).action).toEqual({
      type: 'plan',
      note: null,
    });
    expect(nextStep(ask!.state, { type: 'clarified', start: 'build' }).action).toMatchObject({
      role: 'builder',
    });
    expect(nextStep(ask!.state, { type: 'clarified', start: null }).action).toMatchObject({
      type: 'finish',
      status: 'cancelled',
    });
  });

  it('asks for a reading of a vague request, then builds', () => {
    const [ask] = run(flow(), [{ type: 'unclear', followUp: false }]);
    expect(ask!.action).toMatchObject({ type: 'ask', kind: 'clarify', interpret: true });
  });

  it('keeps, fixes or reverts from the keep card', () => {
    const [, , wrapped] = run(flow(), [
      { type: 'start', start: 'build' },
      built(),
      { type: 'wrapped', filesChanged: 1 },
    ]);
    const answer = (optionId: string, note: string | null = null) =>
      nextStep(wrapped!.state, { type: 'answered', kind: 'accept', optionId, note }).action;
    expect(answer(CHECKPOINT_OPTION.keep)).toMatchObject({ type: 'finish', status: 'succeeded' });
    expect(answer(CHECKPOINT_OPTION.revert)).toEqual({ type: 'revert' });
    expect(answer(CHECKPOINT_OPTION.fix, 'Use UTC')).toMatchObject({
      type: 'spawn',
      role: 'builder',
      reason: 'fix',
      note: 'Use UTC',
    });
  });

  it('continues past a spent budget with the same agent, or stops with a report', () => {
    const [, spent] = run(flow(), [
      { type: 'start', start: 'build' },
      { type: 'budget_exceeded', limit: 'tool_calls' },
    ]);
    expect(spent!.action).toMatchObject({ type: 'ask', kind: 'budget' });
    const resumed = nextStep(spent!.state, {
      type: 'answered',
      kind: 'budget',
      optionId: CHECKPOINT_OPTION.continueBudget,
      note: null,
    });
    expect(resumed.action).toMatchObject({ type: 'spawn', role: 'builder', reason: 'resume' });
    const stopped = nextStep(spent!.state, {
      type: 'answered',
      kind: 'budget',
      optionId: CHECKPOINT_OPTION.stop,
      note: null,
    });
    expect(stopped.action).toMatchObject({
      type: 'finish',
      status: 'failed',
      reason: 'Stopped: the tool calls budget ran out.',
    });
  });

  it('runs the planned step unchanged when the budget ran out before it started', () => {
    const [planned, spent] = run(flow(), [
      { type: 'start', start: 'build' },
      { type: 'budget_exceeded', limit: 'cost', unstarted: true },
    ]);
    const resumed = nextStep(spent!.state, {
      type: 'answered',
      kind: 'budget',
      optionId: CHECKPOINT_OPTION.continueBudget,
      note: null,
    });
    expect(resumed.action).toEqual(planned!.action);
  });

  it('stops on Stop', () => {
    const [, stopped] = run(flow(), [{ type: 'start', start: 'build' }, { type: 'stopped' }]);
    expect(stopped!.action).toMatchObject({ type: 'finish', status: 'cancelled' });
  });
});

describe('read-only work: a plan, or a review of existing changes', () => {
  it('writes a plan, asks to approve it, and finishes without building (dev-day s03)', () => {
    const [start, approved] = run(flow(), [
      { type: 'start', start: 'plan' },
      { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.approvePlan, note: null },
    ]);
    expect(start!.action).toEqual({ type: 'plan', note: null });
    expect(start!.state).toMatchObject({ depth: 'direct', readOnly: 'plan', phase: 'planning' });
    expect(approved!.action).toMatchObject({ type: 'finish', status: 'succeeded' });
  });

  it('revises the plan with the user’s note, and stops when asked', () => {
    const [, revised, stopped] = run(flow(), [
      { type: 'start', start: 'plan' },
      { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.editPlan, note: ' add tests ' },
      { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.stop, note: null },
    ]);
    expect(revised!.action).toEqual({ type: 'plan', note: 'add tests' });
    expect(stopped!.action).toMatchObject({ type: 'finish', status: 'cancelled' });
  });

  it('finishes when the planner fails or writes nothing', () => {
    const [, failed] = run(flow(), [
      { type: 'start', start: 'plan' },
      { type: 'agent_done', role: 'scout', outcome: 'failed', error: 'no plan' },
    ]);
    expect(failed!.action).toMatchObject({ type: 'finish', status: 'failed', reason: 'no plan' });
  });

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
