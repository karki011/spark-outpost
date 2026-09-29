import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, clarifyOptionId } from '@spark-outpost/contracts';
import {
  FOLLOW_UP_QUESTION,
  chosenFollowUp,
  followUpCard,
  offersNextStep,
  vagueFollowUpByRule,
} from './follow-up.ts';

const facts = (
  request: string,
  extra: Partial<Parameters<typeof vagueFollowUpByRule>[0]> = {},
) => ({
  request,
  namedFiles: 0,
  previousReply: 'The parser now handles empty input.',
  recentTask: false,
  ...extra,
});

describe('vague follow-ups', () => {
  it('reads "do it", "fix that", "continue" and "wrap up" with no referent as vague', () => {
    for (const request of [
      'do it',
      'fix that',
      'continue',
      'wrap up',
      'ok, carry on',
      'fix the thing',
      'sort it out',
      'clean it up',
    ]) {
      expect(vagueFollowUpByRule(facts(request)), request).toBe(true);
    }
  });

  it('is clear when the previous reply offered a next step or the task is still warm', () => {
    const offered = 'I can add a retry to the upload. Want me to do that?';
    expect(vagueFollowUpByRule(facts('do it', { previousReply: offered }))).toBe(false);
    expect(vagueFollowUpByRule(facts('continue', { recentTask: true }))).toBe(false);
  });

  it('is clear when it names a file or says what to do', () => {
    expect(vagueFollowUpByRule(facts('fix that', { namedFiles: 1 }))).toBe(false);
    expect(vagueFollowUpByRule(facts('fix the date formatter test'))).toBe(false);
    expect(vagueFollowUpByRule(facts('any feedback'))).toBe(false);
  });

  it('spots a reply that proposes steps or offers to go on', () => {
    expect(offersNextStep('Plan:\n1. Add the column\n2. Backfill it')).toBe(true);
    expect(offersNextStep('Should I also update the docs?')).toBe(true);
    expect(offersNextStep('Done. The tests pass.')).toBe(false);
    expect(offersNextStep(null)).toBe(false);
  });
});

describe('the follow-up question', () => {
  it('asks once whether to answer, plan or change, and waits for the user', () => {
    const card = followUpCard('why');
    expect(card).toMatchObject({ kind: 'clarify', title: FOLLOW_UP_QUESTION });
    expect(FOLLOW_UP_QUESTION).toBe('Want me to answer, plan it, or make the change?');
    expect(card.options.map((option) => option.name)).toEqual([
      'Answer it; change nothing',
      'Plan it first',
      'Make the change',
      'Answer in your own words',
      'Stop',
    ]);
    expect(card.payload.autoOption).toBeNull();
  });

  it('maps each choice to how the turn starts', () => {
    const card = followUpCard('why');
    expect(chosenFollowUp(card, clarifyOptionId(0), null)).toEqual({ start: 'answer', note: null });
    expect(chosenFollowUp(card, clarifyOptionId(1), null)).toEqual({ start: 'plan', note: null });
    expect(chosenFollowUp(card, clarifyOptionId(2), null)).toEqual({ start: 'build', note: null });
    expect(chosenFollowUp(card, CHECKPOINT_OPTION.answer, ' the date tests ')).toEqual({
      start: 'build',
      note: 'the date tests',
    });
    expect(chosenFollowUp(card, CHECKPOINT_OPTION.stop, null)).toBeNull();
  });
});
