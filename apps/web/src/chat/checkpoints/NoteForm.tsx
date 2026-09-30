import { useId, useState } from 'react';

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
