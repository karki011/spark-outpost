import { describe, expect, it } from 'vitest';
import { shortWindowNote } from './long-context.ts';

describe('shortWindowNote', () => {
  const opus = { '_claude/model': 'claude-opus-5-5' };

  it('says when a 1M model runs with a smaller window on this account', () => {
    expect(shortWindowNote(opus, 200_000)).toBe(
      'Opus 5.5 is using a 200K context window on this account, not 1M',
    );
  });

  it('stays quiet at the full window, for 200K models and for unknown models', () => {
    expect(shortWindowNote(opus, 1_000_000)).toBeNull();
    expect(shortWindowNote({ '_claude/model': 'claude-haiku-4-5' }, 200_000)).toBeNull();
    expect(shortWindowNote({ '_claude/model': 'mystery' }, 200_000)).toBeNull();
    expect(shortWindowNote(undefined, 200_000)).toBeNull();
  });
});
