import { describe, expect, it } from 'vitest';
import { stepSuggestion } from './AddressSuggestions.tsx';

describe('stepSuggestion', () => {
  it('moves down from the typed text through the list and back to the text', () => {
    expect(stepSuggestion(-1, 3, 'ArrowDown')).toBe(0);
    expect(stepSuggestion(1, 3, 'ArrowDown')).toBe(2);
    expect(stepSuggestion(2, 3, 'ArrowDown')).toBe(-1);
  });

  it('moves up from the typed text to the last row', () => {
    expect(stepSuggestion(-1, 3, 'ArrowUp')).toBe(2);
    expect(stepSuggestion(0, 3, 'ArrowUp')).toBe(-1);
  });

  it('ignores other keys and an empty list', () => {
    expect(stepSuggestion(0, 3, 'Enter')).toBeNull();
    expect(stepSuggestion(-1, 0, 'ArrowDown')).toBeNull();
  });
});
