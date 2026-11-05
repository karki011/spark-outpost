import './disconnect-dialog.css';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { wrapTabFocus } from '../ui/focus-trap.ts';

export interface DisconnectCopy {
  title: string;
  text: string;
}

interface DisconnectDialogProps {
  copy: DisconnectCopy;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const FOCUSABLE = 'button:not([disabled])';

export function DisconnectDialog({
  copy,
  confirmLabel = 'Disconnect',
  onCancel,
  onConfirm,
}: DisconnectDialogProps) {
  const titleId = useId();
  const textId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    const box = event.currentTarget;
    wrapTabFocus(event, () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  };
  return createPortal(
    <div
      className="cx-confirm-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div
        className="cx-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
      >
        <h3 id={titleId}>{copy.title}</h3>
        <p id={textId}>{copy.text}</p>
        <div className="cx-confirm-foot">
          <button ref={cancelRef} type="button" className="btn line sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn sm cx-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
