import { describe, expect, it } from 'vitest';
import { cacheSavingUsd, resumeSavings } from './resume.ts';

describe('resume savings', () => {
  it('prices cached input a resumed session did not resend', () => {
    const resumed = {
      provider: 'claude',
      model: 'claude-sonnet-5',
      modelLabel: null,
      cachedReadTokens: 500_000,
      resumed: true,
    };
    expect(cacheSavingUsd(resumed)).toBeCloseTo(0.9, 6);
    expect(cacheSavingUsd({ ...resumed, model: 'unknown-model' })).toBe(0);
    expect(
      resumeSavings([
        resumed,
        { ...resumed, resumed: false },
        { ...resumed, cachedReadTokens: null },
      ]),
    ).toEqual({ resumedRuns: 2, sessionRuns: 3, cachedTokens: 500_000, savedUsd: 0.9 });
  });
});
