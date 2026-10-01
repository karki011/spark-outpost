import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_LEVELS,
  DEFAULT_COMMAND_NOTE,
  DEFAULT_INVOLVEMENT_LEVEL,
  autonomyLabel,
  commandSandboxNote,
  involvementLevelSchema,
} from './approvals.ts';

describe('harness autonomy', () => {
  it('offers three choices with the new names, Automatic by default', () => {
    expect(AUTONOMY_LEVELS.map((level) => [level.id, level.label])).toEqual([
      ['balanced', 'Review each step'],
      ['hands-off', 'Automatic'],
      ['full-auto', 'Full auto → PR'],
    ]);
    expect(DEFAULT_INVOLVEMENT_LEVEL).toBe('hands-off');
    expect(autonomyLabel('full-auto')).toBe('Full auto → PR');
  });

  it('says what each choice does in plain words', () => {
    const hints = Object.fromEntries(AUTONOMY_LEVELS.map((level) => [level.id, level.hint]));
    expect(hints.balanced).toMatch(/card before risky work/);
    expect(hints['hands-off']).toMatch(/worktree copy.*Revert/);
    expect(hints['full-auto']).toMatch(/opens a PR.*Nothing ever merges/);
  });

  it('reads the removed Hands-on level as Review each step', () => {
    expect(involvementLevelSchema.parse('hands-on')).toBe('balanced');
    expect(involvementLevelSchema.parse('full-auto')).toBe('full-auto');
    expect(involvementLevelSchema.safeParse('hands-free').success).toBe(false);
  });
});

describe('command sandbox note', () => {
  it("names Codex's sandbox and says other agents' commands aren't sandboxed", () => {
    expect(commandSandboxNote('claude')).toBe(DEFAULT_COMMAND_NOTE);
    expect(commandSandboxNote('codex')).toMatch(/Codex's sandbox without network/);
  });
});
