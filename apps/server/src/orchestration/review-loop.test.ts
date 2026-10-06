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

  it('stops after one retry when an earlier finding comes back next to a new one', () => {
    const results = run('hands-off', [reviewedAs(A), built(), reviewedAs([...C, ...A])]);
    expect(actions(results).slice(2)).toEqual(['builder:fix', 'critic:recheck', 'wrap_up']);
    expect(results.at(-1)!.state.review).toMatchObject({
      stop: 'repeated',
      fixRounds: 1,
      fixable: [...C, ...A],
    });
  });

  it('stops when a finding from an earlier round returns after a different one', () => {
    const results = run('hands-off', [
      reviewedAs(A),
      built(),
      reviewedAs(B),
      built(),
      reviewedAs(A),
    ]);
    expect(actions(results).filter((action) => action === 'builder:fix')).toHaveLength(2);
    expect(results.at(-1)!.state.review).toMatchObject({ stop: 'repeated', fixRounds: 2 });
  });

  it('stops after three fix rounds and keeps with the concerns as a note at Automatic', () => {
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
      type: 'keep',
      note: 'Kept automatically; worth a look: the Critic still has concerns. Revert undoes them.',
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
    expect(results.at(-1)!.action).toMatchObject({ type: 'ship' });
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
    expect(actions(run('hands-off', [reviewedAs()])).at(-1)).toBe('wrap_up');
    const styleOnly = run('hands-off', [
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
      { type: 'agent_done', role: 'critic', outcome: 'failed', error: 'boom' },
    ]);
    expect(actions(results).at(-2)).toBe('critic:retry');
    expect(results.at(-1)!.state.review.stop).toBe('unclear');
    expect(results.at(-1)!.state.criticSkipped).toBe('boom');
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
    expect(normalizeFinding(`[missing] ${B[0]}`)).toBe(normalizeFinding(`[bug] ${B[0]}`));
    expect(repeatsPrevious([...A, ...B], A)).toBe(true);
    expect(repeatsPrevious(A, [...A, ...C])).toBe(true);
    expect(repeatsPrevious(A, C)).toBe(false);
    expect(repeatsPrevious([], A)).toBe(false);
  });

  it('writes the fix follow-up with the findings', () => {
    const text = criticFixFollowUp(A);
    expect(text.startsWith(CRITIC_FIX_LEAD)).toBe(true);
    expect(text).toContain(`## Review findings to fix\n- ${A[0]}`);
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
    expect(nextStep(state, { type: 'wrapped', filesChanged: 0 }).action).toMatchObject({
      type: 'finish',
    });
  });

  it('raises the keep card when shipping is held', () => {
    const shipping = nextStep(initialFlow('edits', 'full-auto'), wrapped);
    const held = nextStep(shipping.state, { type: 'ship_held', reason: 'Checks still fail.' });
    expect(held.action).toEqual({ type: 'ask', kind: 'accept', reason: 'Checks still fail.' });
  });
});
