import './sub-chat-rows.css';
import type { KeyboardEvent, ReactNode } from 'react';
import { shownChatTitle, type ConversationSummary } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { ChatRows } from './ChatRows.tsx';
import { needsYouCount, needsYouLabel, subChatCountLabel, subChatRowsId } from './sub-chat-tree.ts';

export interface SubChatSlot {
  subs: readonly ConversationSummary[];
  open: boolean;
  onToggle: () => void;
  renderRow: (chat: ConversationSummary, index: number) => ReactNode;
}

interface BranchProps {
  parent: ConversationSummary;
  slot: SubChatSlot;
}

const bodyId = (parentId: string): string => `sub-chats-${parentId}`;

export function SubChatFold({ parent, slot }: BranchProps) {
  return (
    <button
      type="button"
      className="sub-fold"
      aria-expanded={slot.open}
      aria-controls={bodyId(parent.id)}
      aria-label={`${subChatCountLabel(slot.subs.length)} of ${shownChatTitle(parent.title)}`}
      title={slot.open ? 'Hide sub-chats' : 'Show sub-chats'}
      onClick={slot.onToggle}
    >
      <ChevronIcon />
    </button>
  );
}

export function SubChatNeeds({ subs }: { subs: readonly ConversationSummary[] }) {
  const count = needsYouCount(subs);
  if (count === 0) return null;
  const label = needsYouLabel(count);
  return (
    <span className="sub-needs" title={label}>
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">, {label}</span>
    </span>
  );
}

export function SubChatRows({ parent, slot }: BranchProps) {
  return (
    <div className="sub-body" id={bodyId(parent.id)} inert={!slot.open}>
      <ChatRows
        id={subChatRowsId(parent.id)}
        chats={slot.subs}
        sortable={false}
        nestedLabel={`Sub-chats of ${shownChatTitle(parent.title)}`}
        renderRow={slot.renderRow}
      />
    </div>
  );
}

const rowButton = (root: HTMLElement, selector: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(selector);

export function treeKeyDown(event: KeyboardEvent<HTMLElement>, slot: SubChatSlot): void {
  const left = event.key === 'ArrowLeft';
  if (!left && event.key !== 'ArrowRight') return;
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches('button.row-open')) return;
  const root = event.currentTarget;
  const own = rowButton(root, ':scope > .row > .row-open');
  if (target !== own) {
    if (!left) return;
    event.preventDefault();
    own?.focus();
    return;
  }
  event.preventDefault();
  if (left === slot.open) slot.onToggle();
  else if (!left) rowButton(root, '.sub-rows .row-open')?.focus();
}
