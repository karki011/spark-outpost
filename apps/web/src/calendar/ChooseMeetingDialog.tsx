import { useEffect, useId, type KeyboardEvent } from 'react';
import type { CalendarEvent } from '@spark-outpost/contracts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { MeetingChoices } from './MeetingChoices.tsx';

interface ChooseMeetingDialogProps {
  meetings: readonly CalendarEvent[];
  now: number;
  calendarName: (event: CalendarEvent) => string;
  onOpen: (event: CalendarEvent) => void;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled])';

export function ChooseMeetingDialog(props: ChooseMeetingDialogProps) {
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      props.onClose();
      return;
    }
    const current = event.currentTarget;
    wrapTabFocus(event, () => [...current.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  };
  return (
    <div
      className="dlg"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div
        className="dlg-panel cal-choose"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="dlg-head">
          <div>
            <h3 id={titleId}>Choose a meeting</h3>
            <small>They overlap. Nothing joins until you pick one.</small>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={props.onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="dlg-body">
          <MeetingChoices
            meetings={props.meetings}
            now={props.now}
            calendarName={props.calendarName}
            onOpen={(event) => {
              props.onClose();
              props.onOpen(event);
            }}
            onJoined={props.onClose}
            buttonClass={{ join: 'btn primary sm', open: 'btn line sm' }}
            focusFirst
          />
        </div>
      </div>
    </div>
  );
}
