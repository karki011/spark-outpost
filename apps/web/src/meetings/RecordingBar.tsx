import './meetings.css';
import { LiveElapsed } from '../ui/LiveElapsed.tsx';
import { useMeeting, useMeetingStatus, useStopMeeting } from './use-meetings.ts';

function Bar({ id, onOpen }: { id: string; onOpen: ((id: string) => void) | undefined }) {
  const meeting = useMeeting(id).data?.meeting;
  const stop = useStopMeeting();
  const title = meeting?.title ?? 'Meeting';
  return (
    <div className="mt mt-bar" role="region" aria-label="Recording">
      <span className="mt-dot" aria-hidden="true" />
      <span className="mt-bar-word">Recording</span>
      {onOpen ? (
        <button type="button" className="mt-bar-title mt-link" onClick={() => onOpen(id)}>
          {title}
        </button>
      ) : (
        <span className="mt-bar-title">{title}</span>
      )}
      {meeting && <LiveElapsed since={Date.parse(meeting.startedAt)} className="mt-bar-time" />}
      <button
        type="button"
        className="btn primary sm"
        disabled={stop.isPending}
        onClick={() => stop.mutate(id)}
      >
        Stop
      </button>
      {stop.isError && <span role="alert">Couldn’t stop. {stop.error.message}</span>}
    </div>
  );
}

export function RecordingBar({ onOpen }: { onOpen?: (id: string) => void }) {
  const recordingId = useMeetingStatus().data?.recordingId;
  if (!recordingId) return null;
  return <Bar key={recordingId} id={recordingId} onOpen={onOpen} />;
}
