import {
  BROWSER_SELECTED_TEXT_MAX,
  addressToUrl,
  classifyBrowserUrl,
  redactText,
} from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';

export type SelectionIntent = 'add' | 'ask';
export type SendsTo = 'chat' | 'terminal';

export interface SelectionMenuFacts {
  selectionText: string;
  isEditable: boolean;
  linkURL?: string;
}

export interface PageHistoryFacts {
  canGoBack: boolean;
  canGoForward: boolean;
}

export type PageEdit = 'cut' | 'copy' | 'paste' | 'selectAll';
export type PageStep = 'back' | 'forward' | 'reload';

export type SelectionMenuItem =
  | { kind: 'send'; label: string; intent: SelectionIntent }
  | { kind: 'separator' }
  | { kind: 'copy'; label: string }
  | { kind: 'open_link'; label: string; url: string }
  | { kind: 'copy_link'; label: string; url: string }
  | { kind: 'edit'; label: string; action: PageEdit }
  | { kind: 'step'; label: string; action: PageStep; enabled: boolean };

export interface ShortcutInput {
  type: string;
  code: string;
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
}

const UNSAFE_CONTROLS = /[^\P{Cc}\n\t]/gu;

const SELECTION_READ = `(() => {
  const active = document.activeElement;
  if (active && (active.isContentEditable || active.matches('input, textarea, select'))) return '';
  return String(getSelection() ?? '');
})()`;

export function selectedPageText(raw: string): string | null {
  const cleaned = redactText(raw.replace(/\r\n?/g, '\n').replace(UNSAFE_CONTROLS, ''))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= BROWSER_SELECTED_TEXT_MAX) return cleaned;
  return `${cleaned.slice(0, BROWSER_SELECTED_TEXT_MAX - 1).trimEnd()}…`;
}

export function webLink(raw: string): string | null {
  if (raw === '') return null;
  const kind = classifyBrowserUrl(raw);
  if (kind !== 'local' && kind !== 'external') return null;
  return addressToUrl(raw);
}

function linkItems(facts: SelectionMenuFacts): SelectionMenuItem[] {
  const url = webLink(facts.linkURL ?? '');
  if (!url) return [];
  return [
    { kind: 'open_link', label: 'Open link in new tab', url },
    { kind: 'copy_link', label: 'Copy link', url },
  ];
}

function textItems(facts: SelectionMenuFacts, sendsTo: SendsTo): SelectionMenuItem[] {
  if (facts.isEditable) {
    return [
      { kind: 'edit', label: 'Cut', action: 'cut' },
      { kind: 'edit', label: 'Copy', action: 'copy' },
      { kind: 'edit', label: 'Paste', action: 'paste' },
      { kind: 'edit', label: 'Select all', action: 'selectAll' },
    ];
  }
  if (selectedPageText(facts.selectionText) === null) return [];
  return [
    {
      kind: 'send',
      label: sendsTo === 'terminal' ? 'Add to terminal' : 'Add to chat',
      intent: 'add',
    },
    { kind: 'send', label: 'Ask about this', intent: 'ask' },
    { kind: 'separator' },
    { kind: 'copy', label: 'Copy' },
  ];
}

function stepItems(history: PageHistoryFacts): SelectionMenuItem[] {
  return [
    { kind: 'step', label: 'Back', action: 'back', enabled: history.canGoBack },
    { kind: 'step', label: 'Forward', action: 'forward', enabled: history.canGoForward },
    { kind: 'step', label: 'Reload', action: 'reload', enabled: true },
  ];
}

export function selectionMenuItems(
  facts: SelectionMenuFacts,
  picking: boolean,
  sendsTo: SendsTo,
  history: PageHistoryFacts,
): SelectionMenuItem[] {
  if (picking) return [];
  const groups = [linkItems(facts), textItems(facts, sendsTo)].filter((group) => group.length > 0);
  if (groups.length === 0) return stepItems(history);
  return groups.flatMap((group, index) =>
    index === 0 ? group : [{ kind: 'separator' } as const, ...group],
  );
}

export function isAddShortcut(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (input.type !== 'keyDown' || input.code !== 'KeyA' || !input.shift || input.alt) return false;
  return platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
}

export function isDevtoolsShortcut(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (input.type !== 'keyDown' || input.code !== 'KeyI' || !input.alt || input.shift) return false;
  return platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
}

export async function readPageSelection(cdp: Cdp): Promise<string> {
  const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>(
    'Page.getFrameTree',
  );
  const { executionContextId } = await cdp.send<{ executionContextId: number }>(
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: 'spark-selection' },
  );
  const { result } = await cdp.send<{ result: { value?: unknown } }>('Runtime.evaluate', {
    expression: SELECTION_READ,
    contextId: executionContextId,
    returnByValue: true,
  });
  return typeof result.value === 'string' ? result.value : '';
}
