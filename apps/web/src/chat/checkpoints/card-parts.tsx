import { useId, useState, type ReactNode } from 'react';
import type { CheckpointPayload } from '@spark-outpost/contracts';
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

const ACTION_CLASS = {
  primary: 'btn primary sm',
  line: 'btn line sm',
  quiet: 'btn ghost sm',
  stop: 'btn ghost sm deny',
} as const;

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
  kind?: keyof typeof ACTION_CLASS;
  children: ReactNode;
}) {
  if (!offers(approval, id)) return null;
  const className = ACTION_CLASS[kind];
  const counting = decide.countdown?.optionId === id ? decide.countdown : null;
  return (
    <button type="button" className={className} disabled={decide.busy} onClick={() => decide(id)}>
      {counting ? <span className="ck-auto">{autoLabel(id, counting.seconds)}</span> : children}
    </button>
  );
}

function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text
        .split('`')
        .map((part, index) =>
          index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>,
        )}
    </>
  );
}

export function CheckpointNotes({ payload }: { payload: CheckpointPayload }) {
  const headingId = useId();
  return (
    <>
      {payload.estimate && <p className="ck-estimate">{payload.estimate}</p>}
      {payload.laws.length > 0 && (
        <div className="ck-laws">
          <p id={headingId}>
            {payload.keptBy ? 'Worth a look' : 'Worth a look before you keep this'}
          </p>
          <ul aria-labelledby={headingId}>
            {payload.laws.map((law) => (
              <li key={law}>
                <InlineCode text={law} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
