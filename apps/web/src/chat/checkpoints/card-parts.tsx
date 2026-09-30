import { useId, useState, type ReactNode } from 'react';
import { autoLabel, offers, type CheckpointApproval } from './checkpoint-model.ts';
import type { Countdown } from './use-auto-continue.ts';

export interface Decide {
  (optionId: string, note?: string): void;
  busy: boolean;
  countdown: Countdown | null;
  hold(): void;
}

function focusOnMount(element: HTMLTextAreaElement | null) {
  element?.focus();
}

export function NoteForm({
  label,
  initial,
  submit,
  onSubmit,
  onCancel,
  onType,
  busy,
}: {
  label: string;
  initial: string;
  submit: string;
  onSubmit(note: string): void;
  onCancel?: () => void;
  onType?: () => void;
  busy: boolean;
}) {
  const [note, setNote] = useState(initial);
  const id = useId();
  return (
    <form
      className="ck-note"
      onSubmit={(event) => {
        event.preventDefault();
        if (note.trim()) onSubmit(note.trim());
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        ref={onCancel ? focusOnMount : undefined}
        id={id}
        className="inp"
        rows={Math.min(8, Math.max(2, initial.split('\n').length + 1))}
        placeholder={label}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          onType?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="ck-note-acts">
        <button type="submit" className="btn primary sm" disabled={busy || !note.trim()}>
          {submit}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function Action({
  id,
  approval,
  decide,
  kind = 'line',
  children,
}: {
  id: string;
  approval: CheckpointApproval;
  decide: Decide;
  kind?: 'primary' | 'line' | 'stop';
  children: ReactNode;
}) {
  if (!offers(approval, id)) return null;
  const className = kind === 'stop' ? 'btn ghost sm deny' : `btn ${kind} sm`;
  const counting = decide.countdown?.optionId === id ? decide.countdown : null;
  return (
    <button type="button" className={className} disabled={decide.busy} onClick={() => decide(id)}>
      {counting ? <span className="ck-auto">{autoLabel(id, counting.seconds)}</span> : children}
    </button>
  );
}
