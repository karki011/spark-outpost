import { describe, expect, it } from 'vitest';
import { offersNextStep, vagueFollowUpByRule } from './follow-up.ts';

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
