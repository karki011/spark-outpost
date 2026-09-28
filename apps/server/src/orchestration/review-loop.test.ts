import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import { acceptCard } from './checkpoint.ts';
import { CRITIC_FIX_LEAD, criticFixFollowUp } from './context.ts';
import { fixOptionLabel, normalizeFinding, repeatsPrevious, reviewLine } from './review-loop.ts';
import {
  initialFlow,
  nextStep,
  type FlowEvent,
  type FlowResult,
  type FlowState,
} from './transitions.ts';

const A = ["`src/money.ts:14`: `parseCents('((5.00)')` returns -500 when it should throw"];
const B = ["`parseCents('-$5.00')` returns 500 instead of -500"];
const C = ['`(+$5)` is accepted when it should be rejected'];
const D = ['Half-cent rounding differs between `-` and `()`'];

const built = (extra: Partial<Extract<FlowEvent, { type: 'agent_done' }>> = {}): FlowEvent => ({
  type: 'agent_done',
  role: 'builder',
  outcome: 'succeeded',
  ...extra,
});

const reviewedAs = (fixable: readonly string[] = [], verdict = 'concerns' as const): FlowEvent => ({
  type: 'agent_done',
  role: 'critic',
  outcome: 'succeeded',
  verdict: fixable.length > 0 ? verdict : 'looks_good',
  ...(fixable.length > 0 ? { fixable } : {}),
});

function run(level: InvolvementLevel, events: readonly FlowEvent[]): FlowResult[] {
  let state: FlowState = initialFlow('edits', level, true);
  const results: FlowResult[] = [];
  for (const event of [{ type: 'start', start: 'build' } as FlowEvent, built(), ...events]) {
    const result = nextStep(state, event);
    results.push(result);
    state = result.state;
  }
  return results;
}

const actions = (results: readonly FlowResult[]) =>
  results.map(({ action }) =>
    action.type === 'spawn' ? `${action.role}:${action.reason}` : action.type,
  );

describe('Critic → fix rounds', () => {
  it.each(['hands-off', 'full-auto'] as const)(
    'fixes correctness findings, reruns the Critic and stops when it is clean at %s',
    (level) => {
      const results = run(level, [reviewedAs(A), built(), reviewedAs()]);
      expect(actions(results)).toEqual([
        'builder:first',
        'critic:first',
        'builder:fix',
        'critic:recheck',
        'wrap_up',
      ]);
      expect(results[2]!.action).toMatchObject({ followUp: criticFixFollowUp(A) });
      const review = results.at(-1)!.state.review;
      expect(review).toMatchObject({ fixRounds: 1, stop: 'clean', fixable: [] });
      expect(review.rounds.map((round) => [round.review, round.action])).toEqual([
        [1, 'fix'],
        [2, 'clean'],
      ]);
      expect(reviewLine(review, 'checks pass')).toBe(
        "Fixed after 1 review round: the Critic's last review found no correctness problems; checks pass.",
      );
    },
  );

  it('keeps going when the next review finds something new, and says it fixed in round 2', () => {
    const results = run('hands-off', [
      reviewedAs(A),
      built(),
      reviewedAs(B),
      built(),
      reviewedAs(),
    ]);
    expect(actions(results).slice(2)).toEqual([
      'builder:fix',
      'critic:recheck',
      'builder:fix',
      'critic:recheck',
      'wrap_up',
    ]);
    expect(results[4]!.action).toMatchObject({ followUp: criticFixFollowUp(B) });
    const review = results.at(-1)!.state.review;
    expect(reviewLine(review, 'checks pass')).toContain('Fixed after 2 review rounds');
    const done = nextStep(results.at(-1)!.state, { type: 'wrapped', filesChanged: 1 });
    expect(done.action).toEqual({ type: 'keep' });
    expect(nextStep(done.state, { type: 'kept' }).action).toMatchObject({
      type: 'finish',
      status: 'succeeded',
    });
    expect(fixOptionLabel(done.state.review)).toBeNull();
  });

  it('stops early when the same findings come back after a fix', () => {
    const moved = ["`src/money.ts:16`: `parseCents('((5.00)')` returns -500 when it should throw"];
    const results = run('hands-off', [reviewedAs(A), built(), reviewedAs(moved)]);
    expect(actions(results).slice(2)).toEqual(['builder:fix', 'critic:recheck', 'wrap_up']);
    const review = results.at(-1)!.state.review;
    expect(review).toMatchObject({ stop: 'repeated', fixRounds: 1 });
    expect(reviewLine(review, 'checks pass')).toContain(
      'Still concerns after 1 round: the same findings came back after the fix',
    );
    expect(fixOptionLabel(review)).toBe('Fix again');
  });

  it('stops after three fix rounds and asks to keep with the concerns at Auto-edit', () => {
    const results = run('hands-off', [
      reviewedAs(A),
      built(),
      reviewedAs(B),
      built(),
      reviewedAs(C),
      built(),
      reviewedAs(D),
      { type: 'wrapped', filesChanged: 1 },
    ]);
    const fixes = actions(results).filter((action) => action === 'builder:fix');
    expect(fixes).toHaveLength(3);
    const state = results.at(-1)!.state;
    expect(state.review).toMatchObject({ stop: 'cap', fixRounds: 3, fixable: D });
    expect(results.at(-1)!.action).toEqual({
      type: 'ask',
      kind: 'accept',
      reason: '1 file changed. Auto-edit asks because the Critic still has concerns.',
    });
    expect(fixOptionLabel(state.review)).toBe('Fix again');
    expect(reviewLine(state.review, 'checks pass')).toBe(
      `Still concerns after 3 rounds: ${D[0]}; checks pass.`,
    );
  });

  it('goes on to ship with the concerns shown at Full auto after the cap', () => {
    const results = run('full-auto', [
      reviewedAs(A),
      built(),
      reviewedAs(B),
      built(),
      reviewedAs(C),
      built(),
      reviewedAs(D),
      { type: 'wrapped', filesChanged: 1 },
    ]);
    expect(results.at(-1)!.action).toEqual({ type: 'ship' });
    expect(results.at(-1)!.state.review.stop).toBe('cap');
  });

  it('stops the loop when checks fail after the fix and the check-fix turns could not fix them', () => {
    const results = run('hands-off', [reviewedAs(A), built({ checksFailing: true })]);
    expect(actions(results).slice(2)).toEqual(['builder:fix', 'wrap_up']);
    const review = results.at(-1)!.state.review;
    expect(review.stop).toBe('checks_failing');
    expect(reviewLine(review, 'checks still fail')).toBe(
      'Stopped after 1 fix round: the checks failed after the fix and the check-fix turns could not fix them.',
    );
  });

  it('runs no fix turn for a looks-good review or style-only concerns', () => {
    expect(actions(run('balanced', [reviewedAs()])).at(-1)).toBe('wrap_up');
    const styleOnly = run('balanced', [
      { type: 'agent_done', role: 'critic', outcome: 'succeeded', verdict: 'concerns' },
    ]);
    expect(actions(styleOnly).at(-1)).toBe('wrap_up');
    expect(styleOnly.at(-1)!.state.review).toMatchObject({ fixRounds: 0, stop: null });
    expect(reviewLine(styleOnly.at(-1)!.state.review, 'checks pass')).toBeNull();
  });

  it('treats a failed recheck as no verdict rather than clean', () => {
    const results = run('hands-off', [
      reviewedAs(A),
      built(),
      { type: 'agent_done', role: 'critic', outcome: 'failed', error: 'boom' },
    ]);
    expect(results.at(-1)!.state.review.stop).toBe('unclear');
  });

  it('offers the fix on the keep card at Ask before edits, one round per answer', () => {
    const results = run('balanced', [reviewedAs(A), { type: 'wrapped', filesChanged: 1 }]);
    expect(actions(results).slice(2)).toEqual(['wrap_up', 'ask']);
    const offered = results.at(-1)!.state;
    expect(fixOptionLabel(offered.review)).toBe('Fix these findings');
    expect(reviewLine(offered.review, 'checks pass')).toBe(
      'The AI review found 1 correctness finding.',
    );
    const fix = nextStep(offered, {
      type: 'answered',
      kind: 'accept',
      optionId: CHECKPOINT_OPTION.fixFindings,
      note: null,
    });
    expect(fix.action).toMatchObject({ type: 'spawn', role: 'builder', reason: 'fix' });
    const recheck = nextStep(fix.state, built());
    expect(recheck.action).toMatchObject({ type: 'spawn', role: 'critic', reason: 'recheck' });
    const second = nextStep(recheck.state, reviewedAs(B));
    expect(second.action).toEqual({ type: 'wrap_up' });
    expect(fixOptionLabel(second.state.review)).toBe('Fix again');
  });

  it('puts the fix option after Keep so Keep stays the default', () => {
    const ids = acceptCard([], '1 file changed.', 'Fix again').options.map(
      (option) => option.optionId,
    );
    expect(ids).toEqual([
      CHECKPOINT_OPTION.keep,
      CHECKPOINT_OPTION.fixFindings,
      CHECKPOINT_OPTION.fix,
      CHECKPOINT_OPTION.revert,
    ]);
    expect(acceptCard([], '1 file changed.').options).toHaveLength(3);
  });
});

describe('repeat detection', () => {
  it('ignores case, punctuation and moved line numbers', () => {
    expect(normalizeFinding('`a.ts:12` Returns -500!')).toBe(
      normalizeFinding('a.ts:40: returns -500'),
    );
    expect(repeatsPrevious([...A, ...B], A)).toBe(true);
    expect(repeatsPrevious(A, [...A, ...C])).toBe(false);
    expect(repeatsPrevious([], A)).toBe(false);
  });

  it('writes the fix follow-up with the findings', () => {
    const text = criticFixFollowUp(A);
    expect(text.startsWith(CRITIC_FIX_LEAD)).toBe(true);
    expect(text).toContain(`## Review findings to fix\n- ${A[0]}`);
  });
});

describe('a budget refusal inside the loop', () => {
  const spent: FlowEvent = { type: 'budget_exceeded', limit: 'cost', unstarted: true };

  it('does not count a fix turn the budget refused, and continuing runs it', () => {
    const results = run('hands-off', [reviewedAs(A), spent]);
    const waiting = results.at(-1)!;
    expect(waiting.action).toMatchObject({ type: 'ask', kind: 'budget' });
    expect(waiting.state.review).toMatchObject({ fixRounds: 0, fixing: false, stop: 'budget' });
    expect(reviewLine(waiting.state.review, 'checks pass')).toBe(
      `The budget ran out before a fix turn for 1 correctness finding from the AI review: ${A[0]}.`,
    );
    const resumed = nextStep(waiting.state, {
      type: 'answered',
      kind: 'budget',
      optionId: CHECKPOINT_OPTION.continueBudget,
      note: null,
    });
    expect(resumed.action).toMatchObject({ type: 'spawn', role: 'builder', reason: 'fix' });
    expect(resumed.state.review).toMatchObject({ fixRounds: 1, fixing: true, stop: null });
  });

  it('says the last fix went unreviewed when the budget refuses the next review', () => {
    const results = run('hands-off', [reviewedAs(A), built(), spent]);
    const review = results.at(-1)!.state.review;
    expect(review).toMatchObject({ fixRounds: 1, fixing: true });
    expect(reviewLine(review, 'checks pass')).toBe(
      "1 fix round ran for the AI review's findings; the Critic did not review the last fix; checks pass.",
    );
  });
});

describe('a limit that cuts a fix round short (N2)', () => {
  it("marks harness-started fix rounds as automatic, and the keep card's as the user's", () => {
    const auto = run('hands-off', [reviewedAs(A)]).at(-1)!;
    expect(auto.action).toMatchObject({ type: 'spawn', reason: 'fix', auto: true });
    const offered = run('balanced', [reviewedAs(A), { type: 'wrapped', filesChanged: 1 }]).at(-1)!;
    const byUser = nextStep(offered.state, {
      type: 'answered',
      kind: 'accept',
      optionId: CHECKPOINT_OPTION.fixFindings,
      note: null,
    });
    expect(byUser.action).toMatchObject({ type: 'spawn', reason: 'fix' });
    expect(byUser.action).not.toHaveProperty('auto');
  });

  it('restores the last passing state and ends on the keep card instead of the budget card', () => {
    const cut = run('hands-off', [
      reviewedAs(A),
      { type: 'budget_exceeded', limit: 'tool_calls', round: true, passing: true },
    ]).at(-1)!;
    expect(cut.action).toEqual({ type: 'restore' });
    expect(cut.state.review).toMatchObject({ fixRounds: 1, fixing: false, stop: 'limit' });
    const restored = nextStep(cut.state, { type: 'restored', restored: true });
    expect(restored.action).toEqual({ type: 'wrap_up' });
    expect(reviewLine(restored.state.review, 'checks pass')).toBe(
      `Stopped fix round 1: fix round 1's own tool-call budget ran out, so Spark Outpost rolled its edits back to the last state that passed the checks. Still open: ${A[0]}.`,
    );
    const keep = nextStep(restored.state, { type: 'wrapped', filesChanged: 2 });
    expect(keep.action).toMatchObject({ type: 'ask', kind: 'accept' });
    expect(keep.action).toMatchObject({
      reason: expect.stringContaining('Auto-edit asks because the Critic still has concerns.'),
    });
  });

  it('keeps the fixed state when the run budget runs out at the re-review (the s04 case)', () => {
    const cut = run('hands-off', [
      reviewedAs(A),
      built(),
      reviewedAs(B),
      built(),
      { type: 'budget_exceeded', limit: 'tool_calls', unstarted: true, passing: true },
    ]).at(-1)!;
    expect(cut.action).toEqual({ type: 'restore' });
    const restored = nextStep(cut.state, { type: 'restored', restored: false });
    expect(restored.state.exceeded).toBe('tool_calls');
    expect(reviewLine(restored.state.review, 'checks pass')).toBe(
      `Stopped fix round 2: the run's tool-call budget ran out, so Spark Outpost kept the last state; checks pass. Still open: ${B[0]}.`,
    );
  });

  it('does not count a fix round that too little budget was left to start', () => {
    const cut = run('hands-off', [
      reviewedAs(A),
      { type: 'budget_exceeded', limit: 'time', unstarted: true, round: true, passing: true },
    ]).at(-1)!;
    expect(cut.action).toEqual({ type: 'restore' });
    expect(cut.state.review).toMatchObject({ fixRounds: 0, stop: 'limit' });
    expect(reviewLine(cut.state.review, 'checks pass')).toBe(
      `Did not start fix round 1: too little of the run's time budget was left for one; kept the change that passed the checks. Still open: ${A[0]}.`,
    );
  });

  it('still asks about the budget when no passing state is there to fall back to', () => {
    const cut = run('hands-off', [
      reviewedAs(A),
      { type: 'budget_exceeded', limit: 'tool_calls' },
    ]).at(-1)!;
    expect(cut.action).toMatchObject({ type: 'ask', kind: 'budget' });
  });

  it('ends on the keep card, not a failure, when the user stops at a budget card before a fix turn', () => {
    const waiting = run('hands-off', [
      reviewedAs(A),
      { type: 'budget_exceeded', limit: 'cost', unstarted: true },
    ]).at(-1)!;
    const stopped = nextStep(waiting.state, {
      type: 'answered',
      kind: 'budget',
      optionId: CHECKPOINT_OPTION.stop,
      note: null,
    });
    expect(stopped.action).toEqual({ type: 'wrap_up' });
  });
});

describe('Full auto runs on to ship', () => {
  const wrapped: FlowEvent = { type: 'wrapped', filesChanged: 2 };

  it('ships after auto Keep only at Full auto, and finishes when shipped', () => {
    const state = initialFlow('edits', 'full-auto');
    const shipping = nextStep(state, wrapped);
    expect(shipping.action).toEqual({ type: 'ship' });
    expect(nextStep(shipping.state, { type: 'shipped' }).action).toMatchObject({
      type: 'finish',
      status: 'succeeded',
    });
    expect(nextStep(initialFlow('edits', 'hands-off'), wrapped).action).toEqual({ type: 'keep' });
    expect(nextStep(initialFlow('edits', 'balanced'), wrapped).action).toMatchObject({
      type: 'ask',
      kind: 'accept',
    });
    expect(nextStep(state, { type: 'wrapped', filesChanged: 0 }).action).toMatchObject({
      type: 'finish',
    });
  });

  it('raises the keep card when shipping is held', () => {
    const shipping = nextStep(initialFlow('edits', 'full-auto'), wrapped);
    const held = nextStep(shipping.state, { type: 'ship_held', reason: 'Checks still fail.' });
    expect(held.action).toEqual({ type: 'ask', kind: 'accept', reason: 'Checks still fail.' });
  });

  it('asks about the budget before shipping, and Continue ships instead of rebuilding', () => {
    const shipping = nextStep(initialFlow('edits', 'full-auto'), wrapped);
    const asked = nextStep(shipping.state, {
      type: 'budget_exceeded',
      limit: 'cost',
      unstarted: true,
    });
    expect(asked.action).toMatchObject({ type: 'ask', kind: 'budget' });
    const answer = (optionId: string) =>
      nextStep(asked.state, { type: 'answered', kind: 'budget', optionId, note: null });
    expect(answer(CHECKPOINT_OPTION.continueBudget).action).toEqual({ type: 'ship' });
    expect(answer(CHECKPOINT_OPTION.stop).action).toMatchObject({
      type: 'finish',
      status: 'failed',
    });
  });
});
