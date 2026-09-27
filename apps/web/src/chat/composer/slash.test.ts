import { describe, expect, it } from 'vitest';
import {
  blockedMessage,
  clientCommand,
  effortHint,
  filterSlashItems,
  findSlashQuery,
  parseSlash,
  planPrompt,
  reviewPrompt,
  slashItems,
  typedCommandNote,
} from './slash.ts';

const context = { agentName: 'Codex' };

const agent = [
  { name: 'compact', description: 'Summarize the conversation', hint: null },
  { name: 'review', description: 'Codex review', hint: null },
  { name: 'logout', description: 'Sign out', hint: null },
  { name: 'status', description: 'Show token usage', hint: null },
  { name: 'rename', description: '', hint: 'new name' },
];

describe('findSlashQuery', () => {
  it('opens only while the caret is in the leading command word', () => {
    expect(findSlashQuery('/com', 4)).toEqual({ query: 'com', end: 4 });
    expect(findSlashQuery('/', 1)).toEqual({ query: '', end: 1 });
    expect(findSlashQuery('/compact now', 12)).toBeNull();
    expect(findSlashQuery(' /compact', 2)).toBeNull();
    expect(findSlashQuery('what about /usr', 15)).toBeNull();
  });
});

describe('slashItems and filtering', () => {
  it('lists our commands first, hides blocked ones and lets ours win a name clash', () => {
    const names = slashItems(agent, context).map((item) => `${item.source}:${item.name}`);
    expect(names).toEqual([
      'client:fresh',
      'client:model',
      'client:effort',
      'client:plan',
      'client:review',
      'agent:compact',
      'agent:status',
      'agent:rename',
    ]);
    const hidden = slashItems(agent, { ...context, hidden: new Set(['fresh'] as const) });
    expect(hidden.map((item) => item.name)).not.toContain('fresh');
  });

  it('ranks name prefixes before matches in the name or description', () => {
    const items = slashItems(agent, context);
    expect(filterSlashItems(items, 'st').map((item) => item.name)).toEqual([
      'status',
      'fresh',
      'plan',
    ]);
    const withE = filterSlashItems(items, 'e');
    expect(withE[0]?.name).toBe('effort');
    expect(withE.length).toBeGreaterThan(1);
    expect(
      withE.every((item) => `${item.name} ${item.description}`.toLowerCase().includes('e')),
    ).toBe(true);
    expect(filterSlashItems(items, 'usage').map((item) => item.name)).toEqual(['status']);
    expect(filterSlashItems(items, 'zzz')).toEqual([]);
  });
});

describe('typed commands', () => {
  it('parses names and arguments', () => {
    expect(parseSlash('/plan  add a login page ')).toEqual({
      name: 'plan',
      args: 'add a login page',
    });
    expect(parseSlash('/fresh')).toEqual({ name: 'fresh', args: '' });
    expect(parseSlash('hello /plan')).toBeNull();
  });

  it('recognizes our commands and blocks harness-owned agent commands', () => {
    expect(clientCommand(parseSlash('/Review the parser'))).toBe('review');
    expect(clientCommand(parseSlash('/compact'))).toBeNull();
    expect(blockedMessage(parseSlash('/logout'))).toBe(
      '/logout is blocked: sign-in is managed in Settings.',
    );
    expect(blockedMessage(parseSlash('/permissions'))).toMatch(/is blocked/);
    expect(blockedMessage(parseSlash('/compact'))).toBeNull();
  });

  it('turns /plan and /review into plain requests, never raw commands', () => {
    expect(planPrompt('add search')).toMatch(/^Make a plan first/);
    expect(planPrompt('add search')).toContain('add search');
    expect(reviewPrompt('')).toBe('Review the changes in this chat and give me a second opinion.');
    expect(reviewPrompt('the parser').startsWith('/')).toBe(false);
  });
});

describe('helper text', () => {
  it('gives every command a description, a hint where it takes one, and a detail line', () => {
    const items = slashItems(agent, {
      agentName: 'Codex',
      effortHint: effortHint([{ id: 'default' }, { id: 'low' }, { id: 'high' }]),
    });
    const byName = new Map(items.map((item) => [item.name, item]));
    expect(byName.get('fresh')?.description).toBe(
      'Start a new agent session for this chat (drops the resumed context)',
    );
    expect(byName.get('effort')?.hint).toBe('low|high');
    expect(byName.get('rename')).toMatchObject({
      description: 'No description from Codex',
      detail:
        "Usage: /rename <new name>. Runs in Codex's session, and only when this chat continues it.",
    });
    for (const item of items) {
      expect(item.description).not.toBe('');
      expect(item.detail).not.toBe('');
    }
  });

  it('explains typed commands that are blocked or unknown', () => {
    const items = slashItems(agent, context);
    expect(typedCommandNote(parseSlash('/logout now'), items, 'Codex')).toBe(
      '/logout is blocked: sign-in is managed in Settings.',
    );
    expect(typedCommandNote(parseSlash('/deploy'), items, 'Codex')).toBe(
      "/deploy isn't a Spark or Codex command, so it's sent as text.",
    );
    expect(typedCommandNote(parseSlash('/compact'), items, 'Codex')).toBeNull();
    expect(typedCommandNote(parseSlash('/model sonnet'), items, 'Codex')).toBeNull();
    expect(typedCommandNote(parseSlash('/plan x'), items, 'Codex')).toBeNull();
    expect(typedCommandNote(parseSlash('hello'), items, 'Codex')).toBeNull();
  });
});
