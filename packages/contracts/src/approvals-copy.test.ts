import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_LEVELS,
  DEFAULT_INVOLVEMENT_LEVEL,
  UNSET_RUN_LEVEL,
  autonomyLabel,
} from './approvals.ts';
import { involvementLevelSchema } from './involvement-levels.ts';

describe('harness autonomy', () => {
  it('offers two choices, Full auto → PR by default', () => {
    expect(AUTONOMY_LEVELS.map((level) => [level.id, level.label])).toEqual([
      ['hands-off', 'Automatic'],
      ['full-auto', 'Full auto → PR'],
    ]);
    expect(DEFAULT_INVOLVEMENT_LEVEL).toBe('full-auto');
    expect(UNSET_RUN_LEVEL).toBe('hands-off');
    expect(autonomyLabel('full-auto')).toBe('Full auto → PR');
  });

  it('says what each choice does in plain words', () => {
    const hints = Object.fromEntries(AUTONOMY_LEVELS.map((level) => [level.id, level.hint]));
    expect(hints['hands-off']).toMatch(/worktree copy.*Revert/);
    expect(hints['full-auto']).toMatch(/opens a PR.*Nothing ever merges/);
  });

  it('reads the removed levels as Automatic', () => {
    expect(involvementLevelSchema.parse('hands-on')).toBe('hands-off');
    expect(involvementLevelSchema.parse('balanced')).toBe('hands-off');
    expect(involvementLevelSchema.parse('full-auto')).toBe('full-auto');
    expect(involvementLevelSchema.safeParse('hands-free').success).toBe(false);
  });
});
