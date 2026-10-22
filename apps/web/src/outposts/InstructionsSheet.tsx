import './outpost-sheet.css';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { OUTPOST_INSTRUCTIONS_MAX } from '@spark-outpost/contracts';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { XIcon } from '../ui/icons.tsx';

interface InstructionsSheetProps {
  initial: string;
  canEdit: boolean;
  onSave: (instructions: string) => Promise<unknown>;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function InstructionsSheet({ initial, canEdit, onSave, onClose }: InstructionsSheetProps) {
  const ids = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fieldRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canEdit) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSave(text.trim());
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      onClose();
      return;
    }
    const panel = event.currentTarget;
    wrapTabFocus(event, () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  };

  return (
    <div
      className="op-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        className="op-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}title`}
        aria-describedby={`${ids}lede`}
        onSubmit={(event) => void submit(event)}
        onKeyDown={onKeyDown}
      >
        <header className="op-sheet-head">
          <h2 id={`${ids}title`}>Instructions</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </header>
        <p id={`${ids}lede`} className="op-sheet-lede">
          Sent to a member chat with each request from this outpost, beside the request and never
          inside it. They grant no permission: a chat's own mode and autonomy still decide what it
          may do.
        </p>
        <div className="op-sheet-body">
          <label className="field">
            <span>Instructions for member chats</span>
            <textarea
              ref={fieldRef}
              className="inp op-brief"
              value={text}
              rows={8}
              maxLength={OUTPOST_INSTRUCTIONS_MAX}
              readOnly={!canEdit}
              aria-describedby={`${ids}count`}
              placeholder="For example: work on spark/* branches from main, and run the tests before you answer."
              onChange={(event) => setText(event.target.value)}
            />
            <small id={`${ids}count`} className="op-sheet-note">
              {canEdit
                ? `${text.length} of ${OUTPOST_INSTRUCTIONS_MAX} characters`
                : 'Instructions are edited on your Mac.'}
            </small>
          </label>
        </div>
        {failure && (
          <p className="op-sheet-failure" role="alert">
            {failure}
          </p>
        )}
        <footer className="op-sheet-foot">
          <button type="button" className="btn sm ghost" disabled={busy} onClick={onClose}>
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button type="submit" className="btn sm primary" disabled={busy}>
              Save
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
