import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import type { IntakeDecisions } from './intake.ts';
import type { Session } from './session.ts';
import { needOf, simpleStep, withoutSparkPlans } from './simple-intake.ts';

const decided = (start: IntakeDecisions['start'], extra: Partial<IntakeDecisions> = {}) =>
  ({ start, then: 'build', trivial: false, continues: null, ...extra }) as IntakeDecisions;
const none = {} as Session;

describe('needOf', () => {
  it('reads the four needs from the start the rules and Jev chose', () => {
    expect(needOf(decided('answer'))).toBe('question');
    expect(needOf(decided('plan'))).toBe('question');
    expect(needOf(decided('ask_agent'))).toBe('needs_you');
    expect(needOf(decided('build'))).toBe('build');
    expect(needOf(decided('plan_first'))).toBe('build');
    expect(needOf(decided('build', { trivial: true }))).toBe('small_change');
    expect(needOf(decided('plan_first', { continues: true }))).toBe('small_change');
  });

  it('keeps a review request apart', () => {
    expect(needOf(decided('review'))).toBe('review');
  });
});

describe('withoutSparkPlans', () => {
  it('never starts with a plan Spark asked for', () => {
    expect(withoutSparkPlans(decided('plan_first', { then: 'plan_first' }))).toMatchObject({
      start: 'build',
      then: 'build',
    });
    expect(withoutSparkPlans(decided('plan', { then: 'plan' }))).toMatchObject({
      start: 'answer',
      then: 'answer',
    });
    expect(withoutSparkPlans(decided('ask_agent'))).toMatchObject({ start: 'ask_agent' });
  });
});

describe('simpleStep', () => {
  it('builds straight away where today a plan card would wait', async () => {
    expect(await simpleStep(none, { type: 'plan_first', note: null })).toEqual({
      event: { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.makeChange, note: null },
    });
  });

  it('answers a plan-only request in the mode the user chose', async () => {
    expect(await simpleStep(none, { type: 'plan', note: null })).toEqual({
      action: { type: 'spawn', role: 'scout', reason: 'first', escalate: false, note: null },
    });
  });

  it('turns a card Spark would raise into the end of the reply', async () => {
    for (const kind of ['clarify', 'retry', 'verify'] as const) {
      expect(
        await simpleStep(none, { type: 'ask', kind, reason: 'Stopped after 2 retries.' }),
      ).toEqual({
        action: {
          type: 'finish',
          status: 'succeeded',
          reason: null,
          incomplete: 'Needs you: Stopped after 2 retries.',
        },
      });
    }
  });

  it('leaves keeping the changes and every ordinary step alone', async () => {
    expect(await simpleStep(none, { type: 'ask', kind: 'accept', reason: 'Keep?' })).toBeNull();
    expect(await simpleStep(none, { type: 'wrap_up' })).toBeNull();
    expect(
      await simpleStep(none, {
        type: 'spawn',
        role: 'builder',
        reason: 'first',
        escalate: false,
        note: null,
      }),
    ).toBeNull();
  });
});
