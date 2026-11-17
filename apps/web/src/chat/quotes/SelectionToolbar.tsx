import './quotes.css';
import {
  useId,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';

const NOTE_MAX_LENGTH = 2000;
const ROVING_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

function keepSelection(event: MouseEvent) {
  if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
}

function rovingTarget(key: string, index: number, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (index + 1) % count;
  return (index - 1 + count) % count;
}

function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!ROVING_KEYS.has(event.key) || event.target instanceof HTMLTextAreaElement) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  const next = rovingTarget(event.key, index, buttons.length);
  event.preventDefault();
  buttons[next]?.focus();
}

export function SelectionToolbar({
  ref,
  commenting,
  children,
}: {
  ref: Ref<HTMLDivElement>;
  commenting: boolean;
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      className={commenting ? 'quote-toolbar commenting' : 'quote-toolbar'}
      role="toolbar"
      aria-label="Selected text"
      onMouseDown={keepSelection}
      onKeyDown={moveFocus}
    >
      {children}
    </div>
  );
}

export function ToolbarButton({
  icon,
  label,
  title,
  keyshortcuts,
  live = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  keyshortcuts?: string;
  live?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="qt-btn"
      title={title}
      aria-keyshortcuts={keyshortcuts}
      onClick={onClick}
    >
      {icon}
      <span className="qt-label" aria-live={live ? 'polite' : undefined}>
        {label}
      </span>
    </button>
  );
}

export function ToolbarSeparator() {
  return <span className="qt-sep" aria-hidden="true" />;
}

export function ToolbarNote({
  label,
  submitLabel,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const noteId = useId();
  const hintId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') return onCancel?.();
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="qt-note" onSubmit={submit}>
      <label className="sr-only" htmlFor={noteId}>
        {label}
      </label>
      <textarea
        id={noteId}
        autoFocus
        rows={1}
        value={value}
        maxLength={NOTE_MAX_LENGTH}
        placeholder="Add a comment…"
        autoComplete="off"
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="qt-note-bar">
        <span id={hintId} className="qt-note-hint">
          Shift+Return for a new line
        </span>
        <button type="submit" className="qt-btn qt-save">
          {submitLabel}
          <span className="qt-save-key" aria-hidden="true">
            ↵
          </span>
        </button>
      </div>
    </form>
  );
}
