import { describe, expect, it } from 'vitest';
import { blockedReason } from '@spark-outpost/contracts';
import {
  SLASH_ESCAPE_NOTE,
  agentCommands,
  allowedCommands,
  slashPrompt,
} from './slash-commands.ts';

describe('agentCommands', () => {
  it('normalizes names, keeps hints and drops duplicates and names with spaces', () => {
    expect(
      agentCommands([
        { name: '/compact', description: ' Summarize ', input: null },
        { name: 'review', description: 'Review', input: { hint: 'what to review' } },
        { name: 'Compact', description: 'again', input: null },
        { name: 'two words', description: 'bad', input: null },
        { name: ' ', description: 'empty', input: null },
      ]),
    ).toEqual([
      { name: 'compact', description: 'Summarize', hint: null },
      { name: 'review', description: 'Review', hint: 'what to review' },
    ]);
  });
});

describe('blocked commands', () => {
  it('blocks commands that change mode, permissions, the session or the sign-in', () => {
    for (const name of ['model', 'permissions', 'plan', 'add-dir', 'clear', 'goal', 'logout']) {
      expect(blockedReason(name)).not.toBeNull();
    }
    expect(blockedReason('/Logout')).not.toBeNull();
    expect(blockedReason('plugin:config')).not.toBeNull();
    expect(blockedReason('compact')).toBeNull();
    expect(blockedReason('mcp:github:list-issues')).toBeNull();
  });

  it('hides blocked commands from the menu list', () => {
    const list = [
      { name: 'compact', description: '', hint: null },
      { name: 'logout', description: '', hint: null },
      { name: 'review', description: '', hint: null },
    ];
    expect(allowedCommands(list).map((command) => command.name)).toEqual(['compact', 'review']);
  });
});

describe('slashPrompt', () => {
  const offered = ['compact', 'review', 'logout'];

  it('leaves ordinary text alone', () => {
    expect(slashPrompt('What does /usr hold?', 'Codex', offered)).toEqual({
      kind: 'text',
      text: 'What does /usr hold?',
      note: null,
    });
  });

  it('sends an advertised command as is, case-insensitively', () => {
    expect(slashPrompt('  /Review src/app.ts', 'Codex', offered)).toEqual({
      kind: 'command',
      text: '/Review src/app.ts',
      note: 'Sent /Review to Codex',
    });
  });

  it('escapes unknown, blocked and bare slashes so the first character is not a slash', () => {
    for (const text of ['/deploy', '/logout', '/', ' /model x']) {
      const result = slashPrompt(text, 'Codex', offered);
      expect(result.kind).toBe('escaped');
      expect(result.text).toBe(`${SLASH_ESCAPE_NOTE}\n\n${text}`);
      expect(result.text.trim().startsWith('/')).toBe(false);
    }
  });

  it('escapes every slash in a session that was not continued', () => {
    expect(slashPrompt('/compact', 'Codex', null)).toMatchObject({
      kind: 'escaped',
      note: 'Sent /compact as text; commands only run in a continued session',
    });
  });
});
