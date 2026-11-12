import './meetings.css';
import { useId } from 'react';
import type { Meeting, StartMeetingRequest } from '@spark-outpost/contracts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { useMeetingStatus, useStartMeeting } from './use-meetings.ts';

const EXPLAIN =
  "Records and transcribes this meeting on this Mac, then writes notes. Doesn't join the call.";
const BUSY = 'Another meeting is recording. Stop it first.';
const OFF = 'Recording isn’t available right now.';

interface TakeNotesButtonProps {
  title?: string;
  eventKey?: string;
  calendarName?: string | undefined;
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
  const recording = Boolean(status.data?.recordingId);
  const unavailable = status.data && !status.data.available ? (status.data.reason ?? OFF) : null;
  const blocked = recording ? BUSY : unavailable;
  const { triggerProps, tooltip } = useTooltip(blocked ?? EXPLAIN, { side: 'bottom' });

  if (!status.data?.supported) return null;

  function begin() {
    if (blocked || start.isPending) return;
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
        aria-disabled={blocked !== null || start.isPending}
        aria-describedby={blocked ? reasonId : triggerProps['aria-describedby']}
        onPointerEnter={triggerProps.onPointerEnter}
        onPointerLeave={triggerProps.onPointerLeave}
        onPointerDown={triggerProps.onPointerDown}
        onFocus={triggerProps.onFocus}
        onBlur={triggerProps.onBlur}
        onClick={begin}
      >
        {label}
      </button>
      {blocked && (
        <span id={reasonId} className={recording ? 'sr-only' : 'mt-take-why'}>
          {blocked}
        </span>
      )}
      {tooltip}
      {start.isError && !blocked && <span role="alert">Couldn’t start. {start.error.message}</span>}
    </span>
  );
}
