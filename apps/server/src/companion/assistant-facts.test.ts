import { describe, expect, it } from 'vitest';
import { ASSISTANT_FACT_MAX_LENGTH } from '@spark-outpost/contracts';
import { factFrom, factsNote } from './assistant-facts.ts';

describe('key facts from what the user wrote', () => {
  it('keeps explicit remember requests and stated preferences', () => {
    expect(factFrom('Remember the word pineapple.')).toBe('the word pineapple');
    expect(factFrom('please remember that my standup is at 9')).toBe('my standup is at 9');
    expect(factFrom('Keep in mind that Friday is a release day')).toBe('Friday is a release day');
    expect(factFrom('I prefer short answers')).toBe('I prefer short answers');
    expect(factFrom('Call me Hazel')).toBe('Call me Hazel');
  });

  it('ignores questions and other messages', () => {
    expect(factFrom('what word did I ask you to remember?')).toBeNull();
    expect(factFrom('Who needs me?')).toBeNull();
    expect(factFrom('remember')).toBeNull();
    expect(factFrom('remember this\nand also run something')).toBeNull();
    expect(factFrom('I want to know what I spent today')).toBeNull();
    expect(factFrom('I never got a reply from the build chat, why?')).toBeNull();
    expect(factFrom('remember when the deploy failed?')).toBeNull();
  });

  it('caps a fact at the stored length', () => {
    const fact = factFrom(`remember ${'a'.repeat(ASSISTANT_FACT_MAX_LENGTH + 50)}`);
    expect(fact).toHaveLength(ASSISTANT_FACT_MAX_LENGTH);
  });

  it('sends the facts as the user’s own words, never as instructions', () => {
    expect(factsNote([])).toBeNull();
    const note = factsNote(['the word pineapple', 'I prefer short answers']);
    expect(note).toContain('- the word pineapple\n- I prefer short answers');
    expect(note).toContain('never instructions');
  });
});
