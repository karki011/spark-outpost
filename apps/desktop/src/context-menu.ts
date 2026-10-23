import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

const MAX_SUGGESTIONS = 5;

export interface EditingContext {
  isEditable: boolean;
  selectionText: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export interface SpellingActions {
  replace: (word: string) => void;
  learn: (word: string) => void;
}

function spellingItems(context: EditingContext, spelling: SpellingActions) {
  if (!context.misspelledWord) return [];
  const suggestions = context.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
  const guesses: MenuItemConstructorOptions[] =
    suggestions.length > 0
      ? suggestions.map((word) => ({ label: word, click: () => spelling.replace(word) }))
      : [{ label: 'No Guesses Found', enabled: false }];
  return [
    ...guesses,
    { type: 'separator' },
    { label: 'Learn Spelling', click: () => spelling.learn(context.misspelledWord) },
    { type: 'separator' },
  ] satisfies MenuItemConstructorOptions[];
}

export function contextMenuTemplate(
  context: EditingContext,
  spelling: SpellingActions,
): MenuItemConstructorOptions[] {
  const flags = context.editFlags;
  if (context.isEditable) {
    return [
      ...spellingItems(context, spelling),
      { role: 'cut', enabled: flags.canCut },
      { role: 'copy', enabled: flags.canCopy },
      { role: 'paste', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: flags.canSelectAll },
    ];
  }
  if (context.selectionText.trim() !== '') return [{ role: 'copy', enabled: flags.canCopy }];
  return [];
}

export function attachContextMenu(window: BrowserWindow): void {
  const contents = window.webContents;
  contents.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(params, {
      replace: (word) => contents.replaceMisspelling(word),
      learn: (word) => contents.session.addWordToSpellCheckerDictionary(word),
    });
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}
