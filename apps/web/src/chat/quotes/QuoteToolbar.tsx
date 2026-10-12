import { useEffect, useRef, useState, type RefObject } from 'react';
import { AskIcon, CommentIcon, CopyIcon, QuoteIcon } from '../../ui/icons.tsx';
import type { AnnotationKind } from '@spark-outpost/contracts';
import { createAnchor } from './anchor.ts';
import { paintHighlight } from './highlight.ts';
import {
  readMessageSelection,
  useSelectionCapture,
  type CapturedSelection,
} from './use-selection-capture.ts';
import type { QuotesState } from './use-quotes.ts';
import { isToolbarShown, useToolbarLayout } from './use-toolbar-layout.ts';
import { messageIdOf } from './selection.ts';
import {
  SelectionToolbar,
  ToolbarButton,
  ToolbarNote,
  ToolbarSeparator,
} from './SelectionToolbar.tsx';

interface QuoteToolbarProps {
  scrollerRef: RefObject<HTMLDivElement | null>;
  quotes: QuotesState;
}

const DRAFT_HIGHLIGHT = 'spark-quote-draft';
const COPIED_MS = 1400;
const APPLE = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
const SHORTCUT_LABEL = APPLE ? '⌘⇧A' : 'Ctrl+Shift+A';

function isAddShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.code === 'KeyA'
  );
}

function quoteFrom(selected: CapturedSelection, kind: AnnotationKind, note = '') {
  return {
    kind,
    text: selected.text,
    note,
    messageId: messageIdOf(selected.source),
    anchor: createAnchor(selected.source, selected.range),
  };
}

function collapseSelection() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) selection.collapseToEnd();
}

export function QuoteToolbar({ scrollerRef, quotes }: QuoteToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [commentFor, setCommentFor] = useState<CapturedSelection | null>(null);
  const [copiedFor, setCopiedFor] = useState<CapturedSelection | null>(null);
  const [note, setNote] = useState('');
  const { captured, dismiss } = useSelectionCapture({
    scrollerRef,
    toolbarRef,
    locked: commentFor !== null,
  });
  if (commentFor && commentFor !== captured) {
    setCommentFor(null);
    setNote('');
  }
  const commenting = captured !== null && commentFor === captured;
  const copied = captured !== null && copiedFor === captured;
  useToolbarLayout({
    range: captured?.range ?? null,
    scrollerRef,
    toolbarRef,
    revision: captured ? `open:${commenting}:${copied}` : '',
  });

  const finish = () => {
    collapseSelection();
    setCommentFor(null);
    setNote('');
    dismiss();
  };

  useEffect(() => {
    if (!commenting || !captured) return;
    return paintHighlight(DRAFT_HIGHLIGHT, [captured.range]);
  }, [commenting, captured]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopiedFor(null), COPIED_MS);
    return () => clearTimeout(timeout);
  }, [copied]);

  const { add } = quotes;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isAddShortcut(event)) {
        const root = scrollerRef.current;
        const selected = root ? readMessageSelection(root) : null;
        if (!selected) return;
        event.preventDefault();
        add(quoteFrom(selected, 'quote'));
        collapseSelection();
        setCommentFor(null);
        dismiss();
        return;
      }
      if (!captured || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setCommentFor(null);
        dismiss();
        return;
      }
      const idle = document.activeElement === document.body || document.activeElement === null;
      if (event.key === 'Tab' && !event.shiftKey && idle && isToolbarShown(toolbarRef.current)) {
        event.preventDefault();
        toolbarRef.current?.querySelector('button')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [captured, add, dismiss, scrollerRef]);

  if (!captured) return null;

  const addToChat = () => {
    add(quoteFrom(captured, 'quote'));
    finish();
  };
  const ask = () => {
    add(quoteFrom(captured, 'ask'));
    quotes.requestFocus();
    finish();
  };
  const copy = () => {
    navigator.clipboard.writeText(captured.text).then(
      () => setCopiedFor(captured),
      () => undefined,
    );
  };
  const saveNote = () => {
    const trimmed = note.trim();
    add(quoteFrom(captured, trimmed ? 'comment' : 'quote', trimmed));
    finish();
  };

  return (
    <SelectionToolbar ref={toolbarRef} commenting={commenting}>
      {commenting ? (
        <ToolbarNote
          label="Comment on the selected text"
          submitLabel="Save"
          value={note}
          onChange={setNote}
          onSubmit={saveNote}
        />
      ) : (
        <>
          <ToolbarButton
            icon={<QuoteIcon />}
            label="Add to chat"
            title={`Add to chat (${SHORTCUT_LABEL})`}
            keyshortcuts="Meta+Shift+A Control+Shift+A"
            onClick={addToChat}
          />
          <ToolbarButton
            icon={<AskIcon />}
            label="Ask about this"
            title="Ask about this"
            onClick={ask}
          />
          <ToolbarButton
            icon={<CommentIcon />}
            label="Comment"
            title="Comment"
            onClick={() => setCommentFor(captured)}
          />
          <ToolbarSeparator />
          <ToolbarButton
            icon={<CopyIcon />}
            label={copied ? 'Copied' : 'Copy'}
            title="Copy"
            live
            onClick={copy}
          />
        </>
      )}
    </SelectionToolbar>
  );
}
