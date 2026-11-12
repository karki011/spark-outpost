import './meetings.css';
import { useId } from 'react';
import type { Meeting, StartMeetingRequest } from '@spark-outpost/contracts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { useMeetingStatus, useStartMeeting } from './use-meetings.ts';

const EXPLAIN =
  "Records and transcribes this meeting on this Mac, then writes notes. Doesn't join the call.";
const BUSY = 'Another meeting is recording. Stop it first.';

interface TakeNotesButtonProps {
  title?: string;
  eventKey?: string;
  calendarName?: string;
  label?: string;
  onStarted?: (meeting: Meeting) => void;
}

export function TakeNotesButton({
  title,
  eventKey,
  calendarName,
  label = 'Take notes',
  onStarted,
}: TakeNotesButtonProps) {
  const status = useMeetingStatus();
  const start = useStartMeeting();
  const reasonId = useId();
  const busy = Boolean(status.data?.recordingId);
  const { triggerProps, tooltip } = useTooltip(busy ? BUSY : EXPLAIN, { side: 'bottom' });

  if (!status.data?.available) return null;

  function begin() {
    if (busy || start.isPending) return;
    const request: StartMeetingRequest = {
      ...(title ? { title } : {}),
      ...(eventKey ? { eventKey } : {}),
      ...(calendarName ? { calendarName } : {}),
    };
    start.mutate(request, { onSuccess: (detail) => onStarted?.(detail.meeting) });
  }

  return (
    <span className="mt mt-take">
      <button
        type="button"
        className="btn line sm"
        aria-disabled={busy || start.isPending}
        aria-describedby={busy ? reasonId : triggerProps['aria-describedby']}
        onPointerEnter={triggerProps.onPointerEnter}
        onPointerLeave={triggerProps.onPointerLeave}
        onPointerDown={triggerProps.onPointerDown}
        onFocus={triggerProps.onFocus}
        onBlur={triggerProps.onBlur}
        onClick={begin}
      >
        {label}
      </button>
      {busy && (
        <span id={reasonId} className="sr-only">
          {BUSY}
        </span>
      )}
      {tooltip}
      {start.isError && <span role="alert">Couldn’t start. {start.error.message}</span>}
    </span>
  );
}
