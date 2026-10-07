import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import type { IntakeDecisions } from './intake.ts';
import type { Session } from './session.ts';
import { readNeed, simpleDecisions, simpleStep } from './simple-intake.ts';

const decided = (start: IntakeDecisions['start'], extra: Partial<IntakeDecisions> = {}) =>
  ({ start, then: 'build', trivial: false, continues: null, ...extra }) as IntakeDecisions;
const none = {} as Session;

describe('readNeed', () => {
  const need = (start: IntakeDecisions['start'], extra: Partial<IntakeDecisions> = {}) =>
    readNeed(decided(start, extra)).need;

  it('falls back to the start the rules chose when Jev did not answer', () => {
    expect(need('answer')).toBe('question');
    expect(need('plan')).toBe('question');
    expect(need('ask_agent')).toBe('needs_you');
    expect(need('build')).toBe('build');
    expect(need('plan_first')).toBe('build');
    expect(need('build', { trivial: true })).toBe('small_change');
    expect(need('plan_first', { continues: true })).toBe('small_change');
    expect(readNeed(decided('build'))).toEqual({
      need: 'build',
      source: 'rules',
      confidence: null,
    });
  });

  it("takes Jev's answer at 0.8 or more, and the rules below it", () => {
    expect(readNeed(decided('build'), { value: 'question', confidence: 0.8 })).toEqual({
      need: 'question',
      source: 'jev',
      confidence: 0.8,
    });
    expect(readNeed(decided('build'), { value: 'question', confidence: 0.79 })).toEqual({
      need: 'build',
      source: 'rules',
      confidence: 0.79,
    });
  });

  it('keeps a review request a review whatever Jev says', () => {
    expect(readNeed(decided('review'), { value: 'build', confidence: 0.95 }).need).toBe('review');
  });
});

describe('simpleDecisions', () => {
  const rules = (need: 'question' | 'small_change' | 'build' | 'needs_you' | 'review') =>
    ({ need, source: 'rules', confidence: null }) as const;

  it('starts the turn the need calls for', () => {
    expect(simpleDecisions(decided('build'), rules('question')).start).toBe('answer');
    expect(simpleDecisions(decided('answer'), rules('needs_you')).start).toBe('ask_agent');
    expect(simpleDecisions(decided('ask_agent'), rules('small_change')).start).toBe('build');
    expect(simpleDecisions(decided('review'), rules('review')).start).toBe('review');
  });

  it('never starts with a plan Spark asked for', () => {
    expect(
      simpleDecisions(decided('plan_first', { then: 'plan_first' }), rules('build')),
    ).toMatchObject({ start: 'build', then: 'build' });
    expect(simpleDecisions(decided('plan', { then: 'plan' }), rules('question'))).toMatchObject({
      start: 'answer',
      then: 'answer',
    });
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
