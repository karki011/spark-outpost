import { addressToUrl, classifyBrowserUrl } from '@spark-outpost/contracts';
import { selectedPageText } from './selection-menu.ts';

export interface ViewMenuFacts {
  selectionText: string;
  isEditable: boolean;
  linkURL: string;
}

export type ViewMenuItem =
  | { kind: 'open_link'; label: string; url: string }
  | { kind: 'link_chat'; label: string; url: string }
  | { kind: 'selection_chat'; label: string; text: string }
  | { kind: 'copy_link'; label: string; url: string }
  | { kind: 'copy'; label: string }
  | { kind: 'separator' };

function webLink(raw: string): string | null {
  if (raw === '') return null;
  const kind = classifyBrowserUrl(raw);
  if (kind !== 'local' && kind !== 'external') return null;
  return addressToUrl(raw);
}

export function viewMenuItems(facts: ViewMenuFacts): ViewMenuItem[] {
  const items: ViewMenuItem[] = [];
  const link = webLink(facts.linkURL);
  if (link) {
    items.push({ kind: 'open_link', label: 'Open link in new tab', url: link });
    items.push({ kind: 'link_chat', label: 'Open link in new chat', url: link });
    items.push({ kind: 'copy_link', label: 'Copy link', url: link });
  }
  const selected = facts.isEditable ? null : selectedPageText(facts.selectionText);
  if (selected) {
    if (items.length > 0) items.push({ kind: 'separator' });
    items.push({ kind: 'selection_chat', label: 'New chat with this', text: selected });
    items.push({ kind: 'copy', label: 'Copy' });
  }
  return items;
}
