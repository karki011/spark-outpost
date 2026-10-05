import { describe, expect, it } from 'vitest';
import {
  CUSTOM_WAIT_ID,
  NEVER_WAIT_ID,
  parsedWait,
  presetSeconds,
  WAIT_OPTIONS,
  waitChoiceId,
  waitHint,
  waitLabel,
} from './auto-continue-model.ts';

describe('wait before going with best guesses', () => {
  it('offers 30s, 60s, 2 min, 5 min, Never and Custom', () => {
    expect(WAIT_OPTIONS.map((option) => option.label)).toEqual([
      '30s',
      '60s',
      '2 min',
      '5 min',
      'Never',
      'Custom',
    ]);
  });

  it('maps a saved wait to its choice, and anything else to Custom', () => {
    expect(waitChoiceId(60)).toBe('60');
    expect(waitChoiceId(null)).toBe(NEVER_WAIT_ID);
    expect(waitChoiceId(45)).toBe(CUSTOM_WAIT_ID);
    expect(waitChoiceId(10)).toBe(CUSTOM_WAIT_ID);
    expect(presetSeconds('120')).toBe(120);
    expect(presetSeconds(NEVER_WAIT_ID)).toBeNull();
    expect(presetSeconds(CUSTOM_WAIT_ID)).toBeUndefined();
  });

  it('accepts whole seconds from 5 to 600 as a custom wait', () => {
    expect(parsedWait('5')).toBe(5);
    expect(parsedWait(' 600 ')).toBe(600);
    expect(parsedWait('4')).toBeNull();
    expect(parsedWait('601')).toBeNull();
    expect(parsedWait('12.5')).toBeNull();
    expect(parsedWait('-30')).toBeNull();
    expect(parsedWait('')).toBeNull();
    expect(parsedWait('soon')).toBeNull();
  });

  it('says what happens after the wait, and that Never waits for you', () => {
    expect(waitLabel(90)).toBe('90s');
    expect(waitHint(300)).toBe('After 5 min, Spark goes with its best guess or the safe option.');
    expect(waitHint(null)).toBe('Spark waits for your answer.');
  });
});
