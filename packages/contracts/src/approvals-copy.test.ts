import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMAND_NOTE,
  DEFAULT_DO_DISCLOSURE,
  INVOLVEMENT_LEVELS,
  commandSandboxNote,
  doDisclosure,
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
    expect(hints['hands-on']).toMatch(/every command and every file change/);
    expect(hints.balanced).toMatch(/Read-only commands in the project are answered for you/);
    expect(hints['hands-off']).toMatch(/separate git copy/);
    expect(hints['full-auto']).toMatch(/may leave Codex's sandbox/);
  });

  it('discloses that Codex can read secret files anywhere', () => {
    expect(doDisclosure('codex')).toMatch(/can read any file on this computer/);
    expect(commandSandboxNote('codex')).toMatch(/Codex's sandbox without network/);
  });
});
