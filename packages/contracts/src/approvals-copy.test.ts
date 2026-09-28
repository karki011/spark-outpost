import { describe, expect, it } from 'vitest';
import {
  ACCESS_CHOICES,
  DEFAULT_COMMAND_NOTE,
  DEFAULT_DO_DISCLOSURE,
  INVOLVEMENT_LEVELS,
  commandSandboxNote,
  doDisclosure,
  accessFor,
  accessUpdate,
  involvementLevelSchema,
  levelHint,
} from './approvals.ts';

describe('Do copy per provider', () => {
  it('keeps the plain level hints for Claude and Z.ai', () => {
    for (const level of INVOLVEMENT_LEVELS) {
      expect(levelHint(level, 'claude')).toBe(level.hint);
      expect(levelHint(level, 'zai')).toBe(level.hint);
    }
    expect(doDisclosure('claude')).toBe(DEFAULT_DO_DISCLOSURE);
    expect(commandSandboxNote('claude')).toBe(DEFAULT_COMMAND_NOTE);
  });

  it('says what Codex asks at each level and where it works', () => {
    const hints = Object.fromEntries(
      INVOLVEMENT_LEVELS.map((level) => [level.id, levelHint(level, 'codex')]),
    );
    expect(Object.keys(hints)).toEqual(['balanced', 'hands-off', 'full-auto']);
    expect(hints.balanced).toMatch(/Read-only commands in the project are answered for you/);
    expect(hints['hands-off']).toMatch(/separate git copy/);
    expect(hints['full-auto']).toMatch(/may leave Codex's sandbox/);
  });

  it('discloses that Codex can read secret files anywhere', () => {
    expect(doDisclosure('codex')).toMatch(/can read any file on this computer/);
    expect(commandSandboxNote('codex')).toMatch(/Codex's sandbox without network/);
  });
});

describe('one list of permission choices', () => {
  it('offers four choices, safest first, with the new names', () => {
    expect(ACCESS_CHOICES.map((choice) => choice.label)).toEqual([
      'Ask',
      'Ask before edits',
      'Auto-edit',
      'Full auto',
    ]);
    expect(ACCESS_CHOICES.map((choice) => [choice.permission, choice.level])).toEqual([
      ['ask', null],
      ['do', 'balanced'],
      ['do', 'hands-off'],
      ['do', 'full-auto'],
    ]);
  });

  it('maps stored permission and level to a choice and back', () => {
    expect(accessFor('ask', 'full-auto')?.label).toBe('Ask');
    expect(accessFor('do', 'hands-off')?.label).toBe('Auto-edit');
    expect(accessFor('do', null)?.label).toBe('Ask before edits');
    expect(accessFor(null, 'balanced')).toBeNull();
    expect(accessUpdate(ACCESS_CHOICES[0]!)).toEqual({ permission: 'ask' });
    expect(accessUpdate(ACCESS_CHOICES[3]!)).toEqual({ permission: 'do', level: 'full-auto' });
  });

  it('reads the removed Hands-on level as Ask before edits', () => {
    expect(involvementLevelSchema.parse('hands-on')).toBe('balanced');
    expect(involvementLevelSchema.parse('full-auto')).toBe('full-auto');
    expect(involvementLevelSchema.safeParse('hands-free').success).toBe(false);
  });
});
