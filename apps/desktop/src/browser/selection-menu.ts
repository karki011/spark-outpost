import { BROWSER_SELECTED_TEXT_MAX, redactText } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';

export type SelectionIntent = 'add' | 'ask';
export type SendsTo = 'chat' | 'terminal';

export interface SelectionMenuFacts {
  selectionText: string;
  isEditable: boolean;
}

export type SelectionMenuItem =
  | { kind: 'send'; label: string; intent: SelectionIntent }
  | { kind: 'separator' }
  | { kind: 'copy'; label: string };

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

export function selectionMenuItems(
  facts: SelectionMenuFacts,
  picking: boolean,
  sendsTo: SendsTo,
): SelectionMenuItem[] {
  if (picking || facts.isEditable || selectedPageText(facts.selectionText) === null) return [];
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

export function isAddShortcut(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (input.type !== 'keyDown' || input.code !== 'KeyA' || !input.shift || input.alt) return false;
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
