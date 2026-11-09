import { Menu, clipboard, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { targetsApi } from './api-token.ts';
import type { LinkIntent } from './link-target.ts';
import { otherLinkTarget } from './link-opening.ts';

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

export interface LinkMenu {
  other: 'spark' | 'browser' | null;
  openOther: () => void;
  copy: () => void;
}

const OTHER_LABEL = { spark: 'Open in Spark', browser: 'Open in Default Browser' } as const;
const OUTSIDE_LINK = /^(https?:|mailto:)/i;

function linkItems(link: LinkMenu | null): MenuItemConstructorOptions[] {
  if (!link) return [];
  const other: MenuItemConstructorOptions[] = link.other
    ? [{ label: OTHER_LABEL[link.other], click: link.openOther }]
    : [];
  return [...other, { label: 'Copy Link', click: link.copy }];
}

function withLink(
  link: LinkMenu | null,
  items: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const forLink = linkItems(link);
  if (forLink.length === 0 || items.length === 0) return [...forLink, ...items];
  return [...forLink, { type: 'separator' }, ...items];
}

export function contextMenuTemplate(
  context: EditingContext,
  spelling: SpellingActions,
  link: LinkMenu | null = null,
): MenuItemConstructorOptions[] {
  return withLink(link, editingItems(context, spelling));
}

function editingItems(
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

export type OpenLink = (url: string, origin: string, intent: LinkIntent) => void;

function pageOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function linkMenu(url: string, page: string, openLink: OpenLink): LinkMenu | null {
  const origin = pageOrigin(page);
  if (!origin || !OUTSIDE_LINK.test(url) || targetsApi(url, origin)) return null;
  return {
    other: otherLinkTarget(url, origin),
    openOther: () => openLink(url, origin, 'other'),
    copy: () => clipboard.writeText(url),
  };
}

export function attachContextMenu(window: BrowserWindow, openLink: OpenLink): void {
  const contents = window.webContents;
  contents.on('context-menu', (_event, params) => {
    const link = params.linkURL ? linkMenu(params.linkURL, contents.getURL(), openLink) : null;
    const spelling: SpellingActions = {
      replace: (word) => contents.replaceMisspelling(word),
      learn: (word) => contents.session.addWordToSpellCheckerDictionary(word),
    };
    const template = contextMenuTemplate(params, spelling, link);
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}
