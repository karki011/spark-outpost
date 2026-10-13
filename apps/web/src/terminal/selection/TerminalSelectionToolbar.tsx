import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { newDraftId } from '../../api/client.ts';
import { requestChat } from '../../app/chat-request.ts';
import { queueDraft } from '../../chat/composer/pending-draft.ts';
import {
  SelectionToolbar,
  ToolbarButton,
  ToolbarNote,
  ToolbarSeparator,
} from '../../chat/quotes/SelectionToolbar.tsx';
import { isOutOfView, toolbarPlacement, type Box } from '../../chat/quotes/toolbar-position.ts';
import { NewChatIcon } from '../../conversations/SidebarHeader.tsx';
import { AskIcon, CommentIcon, CopyIcon, TerminalIcon } from '../../ui/icons.tsx';
import { MAC, hasModifier } from '../../ui/shortcuts.ts';
import type { TerminalSelection } from './follow-selection.ts';
import { newChatDraft, type InsertKind } from './selection-text.ts';
import type { TerminalSelectionState } from './use-terminal-selection.ts';

const COMPACT_BELOW = 620;
const SHORTCUT_LABEL = MAC ? '⌘⇧A' : 'Ctrl+Shift+A';

function isAddShortcut(event: KeyboardEvent): boolean {
  return hasModifier(event) && event.shiftKey && !event.altKey && event.code === 'KeyA';
}

function isInPane(toolbar: HTMLElement | null, target: EventTarget | null): boolean {
  const pane = toolbar?.offsetParent ?? toolbar?.parentElement;
  if (!pane || !(target instanceof Node)) return false;
  return target === document.body || pane.contains(target);
}

function paneBounds(pane: Element): Box {
  const rect = pane.getBoundingClientRect();
  return {
    left: Math.max(rect.left, 0),
    top: Math.max(rect.top, 0),
    right: Math.min(rect.right, window.innerWidth),
    bottom: Math.min(rect.bottom, window.innerHeight),
  };
}

function place(toolbar: HTMLElement, selection: TerminalSelection) {
  const pane = toolbar.offsetParent ?? toolbar.parentElement;
  if (!pane) return;
  const bounds = paneBounds(pane);
  if (isOutOfView({ ...selection, bounds })) {
    toolbar.dataset.shown = 'false';
    return;
  }
  const narrow = bounds.right - bounds.left < COMPACT_BELOW;
  toolbar.dataset.compact = String(narrow && selection.canInsert);
  const size = { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
  const placed = toolbarPlacement({ ...selection, bounds, size });
  const origin = pane.getBoundingClientRect();
  toolbar.style.left = `${Math.round(placed.left - origin.left)}px`;
  toolbar.style.top = `${Math.round(placed.top - origin.top)}px`;
  toolbar.dataset.side = placed.side;
  toolbar.dataset.shown = 'true';
}

function insertAndClose(state: TerminalSelectionState, kind: InsertKind, note = '') {
  const { selection } = state;
  if (!selection) return;
  state.target()?.insertSelection(kind, selection.text, note);
  state.target()?.clearSelection();
  state.dismiss();
}

function openNewChat(state: TerminalSelectionState) {
  const { selection } = state;
  if (!selection) return;
  const conversationId = newDraftId();
  queueDraft(conversationId, newChatDraft(selection.text));
  state.target()?.clearSelection();
  state.dismiss();
  requestChat(conversationId);
}

export function TerminalSelectionToolbar({ state }: { state: TerminalSelectionState }) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const { selection, copied, commenting } = state;

  useLayoutEffect(() => {
    if (toolbarRef.current && selection) place(toolbarRef.current, selection);
  }, [selection, commenting, copied]);

  const canAdd = selection?.canInsert === true && !commenting;
  useEffect(() => {
    if (!canAdd) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAddShortcut(event) || !isInPane(toolbarRef.current, event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      insertAndClose(state, 'add');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [canAdd, state]);

  useEffect(() => {
    if (!commenting) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return;
      state.dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [commenting, state]);

  if (!selection) return null;

  return (
    <SelectionToolbar ref={toolbarRef} commenting={commenting}>
      {commenting ? (
        <ToolbarNote
          label="Note on the selected text"
          submitLabel="Add"
          value={note}
          onChange={setNote}
          onSubmit={() => insertAndClose(state, 'comment', note)}
          onCancel={() => {
            state.comment(false);
            state.target()?.focus();
          }}
        />
      ) : (
        <>
          {selection.canInsert && (
            <>
              <ToolbarButton
                icon={<TerminalIcon />}
                label="Add to terminal"
                title={`Add to terminal (${SHORTCUT_LABEL})`}
                keyshortcuts={MAC ? 'Meta+Shift+A' : 'Control+Shift+A'}
                onClick={() => insertAndClose(state, 'add')}
              />
              <ToolbarButton
                icon={<AskIcon />}
                label="Ask about this"
                title="Ask about this"
                onClick={() => insertAndClose(state, 'ask')}
              />
              <ToolbarButton
                icon={<CommentIcon />}
                label="Comment"
                title="Comment"
                onClick={() => {
                  setNote('');
                  state.comment(true);
                }}
              />
            </>
          )}
          <ToolbarButton
            icon={<NewChatIcon />}
            label="New chat with this"
            title="New chat with this"
            onClick={() => openNewChat(state)}
          />
          <ToolbarSeparator />
          <ToolbarButton
            icon={<CopyIcon />}
            label={copied ? 'Copied' : 'Copy'}
            title={copied ? 'Copied. Select to copy again.' : 'Copy'}
            live
            onClick={state.copy}
          />
        </>
      )}
    </SelectionToolbar>
  );
}
