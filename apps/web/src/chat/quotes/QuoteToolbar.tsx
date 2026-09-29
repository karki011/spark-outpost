import './quotes.css';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
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

interface QuoteToolbarProps {
  scrollerRef: RefObject<HTMLDivElement | null>;
  quotes: QuotesState;
}

const DRAFT_HIGHLIGHT = 'spark-quote-draft';
const NOTE_MAX_LENGTH = 2000;
const COPIED_MS = 1400;
const APPLE = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
const SHORTCUT_LABEL = APPLE ? '⌘⇧A' : 'Ctrl+Shift+A';
const ROVING_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

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

function keepSelection(event: MouseEvent) {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

function rovingTarget(key: string, index: number, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (index + 1) % count;
  return (index - 1 + count) % count;
}

function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!ROVING_KEYS.has(event.key) || event.target instanceof HTMLInputElement) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  const next = rovingTarget(event.key, index, buttons.length);
  event.preventDefault();
  buttons[next]?.focus();
}

export function QuoteToolbar({ scrollerRef, quotes }: QuoteToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const noteId = useId();
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
  const saveNote = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = note.trim();
    add(quoteFrom(captured, trimmed ? 'comment' : 'quote', trimmed));
    finish();
  };

  return (
    <div
      ref={toolbarRef}
      className={commenting ? 'quote-toolbar commenting' : 'quote-toolbar'}
      role="toolbar"
      aria-label="Selected text"
      onMouseDown={keepSelection}
      onKeyDown={moveFocus}
    >
      {commenting ? (
        <form className="qt-note" onSubmit={saveNote}>
          <label className="sr-only" htmlFor={noteId}>
            Comment on the selected text
          </label>
          <input
            id={noteId}
            autoFocus
            value={note}
            maxLength={NOTE_MAX_LENGTH}
            placeholder="Add a note…"
            autoComplete="off"
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="submit" className="qt-btn qt-save">
            Save
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            className="qt-btn"
            title={`Add to chat (${SHORTCUT_LABEL})`}
            aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
            onClick={addToChat}
          >
            <QuoteIcon />
            <span className="qt-label">Add to chat</span>
          </button>
          <button type="button" className="qt-btn" title="Ask about this" onClick={ask}>
            <AskIcon />
            <span className="qt-label">Ask about this</span>
          </button>
          <button
            type="button"
            className="qt-btn"
            title="Comment"
            onClick={() => setCommentFor(captured)}
          >
            <CommentIcon />
            <span className="qt-label">Comment</span>
          </button>
          <span className="qt-sep" aria-hidden="true" />
          <button type="button" className="qt-btn" title="Copy" onClick={copy}>
            <CopyIcon />
            <span className="qt-label" aria-live="polite">
              {copied ? 'Copied' : 'Copy'}
            </span>
          </button>
        </>
      )}
    </div>
  );
}
