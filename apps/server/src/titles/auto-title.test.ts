import { describe, expect, it } from 'vitest';
import { decideAutoTitle, fallbackTitle } from './auto-title.ts';

const fresh = { title: 'please move the date helpers', source: 'message' as const, category: null };

describe('fallback title', () => {
  it('names the category and the main file', () => {
    expect(fallbackTitle('refactor', 'Split src/utils/format.ts into smaller files')).toBe(
      'Refactor · format.ts',
    );
  });

  it('uses a short topic when no file is named, and nothing without a category', () => {
    expect(fallbackTitle('debugging', 'Why does the date divider show twice?')).toBe(
      'Debugging · date divider show',
    );
    expect(fallbackTitle(null, 'Fix format.ts')).toBeNull();
    expect(fallbackTitle('chat', 'hello there')).toBeNull();
    expect(fallbackTitle('question', '??')).toBeNull();
  });
});

describe('auto title decision', () => {
  const turn = { suggested: 'Move date helpers', category: 'refactor' as const, request: 'x' };

  it('replaces a message title with the agent title', () => {
    expect(decideAutoTitle(fresh, turn)).toEqual({
      title: 'Move date helpers',
      origin: 'agent',
      category: 'refactor',
    });
  });

  it('falls back to category and topic when the agent gave no title', () => {
    expect(
      decideAutoTitle(fresh, { suggested: null, category: 'feature', request: 'Add dark mode' }),
    ).toEqual({ title: 'Feature · dark mode', origin: 'fallback', category: 'feature' });
  });

  it('never touches a title the user chose', () => {
    expect(decideAutoTitle({ ...fresh, source: 'user' }, turn)).toBeNull();
  });

  it('retitles a chat title once the chat turns into project work', () => {
    const refused = {
      title: 'Cannot run shell commands here',
      source: 'auto' as const,
      category: 'chat' as const,
    };
    expect(
      decideAutoTitle(refused, { ...turn, suggested: 'Run ls and curl', category: 'setup' }),
    ).toEqual({ title: 'Run ls and curl', origin: 'agent', category: 'setup' });
    expect(decideAutoTitle(refused, { ...turn, category: 'chat' })).toBeNull();
  });

  it('retitles an auto title only when the task clearly changed', () => {
    const titled = {
      title: 'Move date helpers',
      source: 'auto' as const,
      category: 'refactor' as const,
    };
    expect(decideAutoTitle(titled, { ...turn, suggested: 'Tidy helpers' })).toBeNull();
    expect(decideAutoTitle(titled, { ...turn, category: 'chat' })).toBeNull();
    expect(
      decideAutoTitle({ ...titled, category: null }, { ...turn, category: 'docs' }),
    ).toBeNull();
    expect(
      decideAutoTitle(titled, {
        suggested: 'Document date helpers',
        category: 'docs',
        request: 'x',
      }),
    ).toEqual({ title: 'Document date helpers', origin: 'agent', category: 'docs' });
  });
});
