import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { contextMenuTemplate, type EditingContext } from './context-menu.ts';

const ALL_FLAGS = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

function context(change: Partial<EditingContext> = {}): EditingContext {
  return {
    isEditable: true,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: ALL_FLAGS,
    ...change,
  };
}

function build(change: Partial<EditingContext> = {}) {
  const did: string[] = [];
  const template = contextMenuTemplate(context(change), {
    replace: (word) => did.push(`replace ${word}`),
    learn: (word) => did.push(`learn ${word}`),
  });
  return { template, did };
}

const names = (items: MenuItemConstructorOptions[]) =>
  items.map((item) => item.role ?? item.label ?? item.type);

describe('contextMenuTemplate', () => {
  it('gives an editable field Cut, Copy, Paste and Select All by their standard roles', () => {
    const { template } = build();
    expect(names(template)).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
    expect(template.every((item) => item.enabled !== false)).toBe(true);
  });

  it('greys out what the field cannot do right now', () => {
    const { template } = build({
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    });
    const enabled = Object.fromEntries(template.map((item) => [item.role, item.enabled]));
    expect(enabled).toMatchObject({ cut: false, copy: false, paste: true, selectAll: true });
  });

  it('puts spelling suggestions first, at most five, and replaces or learns the word', () => {
    const { template, did } = build({
      misspelledWord: 'recieve',
      dictionarySuggestions: ['receive', 'relieve', 'recipe', 'reprieve', 'retrieve', 'recede'],
    });
    expect(names(template)).toEqual([
      'receive',
      'relieve',
      'recipe',
      'reprieve',
      'retrieve',
      'separator',
      'Learn Spelling',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ]);
    const click = (label: string) =>
      (template.find((item) => item.label === label)!.click as () => void)();
    click('receive');
    click('Learn Spelling');
    expect(did).toEqual(['replace receive', 'learn recieve']);
  });

  it('says so when a misspelled word has no suggestions', () => {
    const { template } = build({ misspelledWord: 'zxqv', dictionarySuggestions: [] });
    expect(template[0]).toMatchObject({ label: 'No Guesses Found', enabled: false });
  });

  it('offers only Copy for selected text outside a field', () => {
    const { template } = build({ isEditable: false, selectionText: 'a reply' });
    expect(names(template)).toEqual(['copy']);
  });

  it('shows nothing on a plain right-click outside a field', () => {
    expect(build({ isEditable: false, selectionText: '  ' }).template).toEqual([]);
  });
});
