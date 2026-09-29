import { useEffect, useRef } from 'react';
import { ticketSourceNames } from '@spark-outpost/contracts';
import type { AssignableTicket } from './use-assign.ts';

export function AssignConfirm({
  ticket,
  onCancel,
  onConfirm,
}: {
  ticket: AssignableTicket;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const questionId = `tk-confirm-${ticket.source}-${ticket.key}`;
  const owner = ticket.assignedTo?.name ?? 'someone';
  useEffect(() => {
    openerRef.current = document.activeElement;
    confirmRef.current?.focus();
  }, []);
  const cancel = () => {
    onCancel();
    if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
  };
  return (
    <div
      className="confirm"
      role="dialog"
      aria-labelledby={questionId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        cancel();
      }}
    >
      <p id={questionId}>
        Take {ticket.key} from {owner}?
      </p>
      <small>
        {`${ticketSourceNames[ticket.source]} makes you the assignee and notifies ${owner.split(' ')[0]}. You can undo right after.`}
      </small>
      <div className="acts">
        <button type="button" className="btn ghost sm" onClick={cancel}>
          Cancel
        </button>
        <button ref={confirmRef} type="button" className="btn primary sm" onClick={onConfirm}>
          Assign to me
        </button>
      </div>
    </div>
  );
}
