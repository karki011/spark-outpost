import { describe, expect, it } from 'vitest';
import { providerFailure } from './provider-state.ts';

describe('providerFailure', () => {
  it('names provider trouble and leaves Builder failures alone', () => {
    expect(providerFailure('Codex is rate limited. Try again in a minute.')).toBe('rate limited');
    expect(providerFailure("Claude isn't signed in. Open Settings.")).toBe('signed out');
    expect(providerFailure('Z.ai reported an error: 1113 insufficient balance')).toBe(
      'out of budget',
    );
    expect(providerFailure('Codex stopped unexpectedly (exit code 3). Try again.')).toBe(
      'unavailable',
    );
    expect(providerFailure('Step 1 broke.')).toBeNull();
    expect(providerFailure(null)).toBeNull();
  });
});
