import './island-recording.css';
import { useRecordingDetail, useStopMeeting } from '../meetings/index.ts';
import { LiveElapsed } from '../ui/LiveElapsed.tsx';

interface IslandRecordingProps {
  id: string;
  variant: 'line' | 'row';
  onOpen: (id: string) => void;
}

export function IslandRecording({ id, variant, onOpen }: IslandRecordingProps) {
  const recording = useRecordingDetail(id);
  const stop = useStopMeeting();
  return (
    <div
      className="isl-rec"
      data-variant={variant}
      role="region"
      aria-label="Recording"
      data-in-place
    >
      <span className="isl-rec-dot" aria-hidden="true" />
      <span className="isl-rec-word">Recording</span>
      <button type="button" className="isl-rec-title" onClick={() => onOpen(id)}>
        {recording.title}
      </button>
      {recording.startedAt !== null && (
        <LiveElapsed since={recording.startedAt} className="isl-rec-time" />
      )}
      {variant === 'line' && (
        <button type="button" className="isl-btn" onClick={() => onOpen(id)}>
          Open transcript
        </button>
      )}
      <button
        type="button"
        className="isl-btn deny"
        disabled={stop.isPending}
        onClick={() => stop.mutate(id)}
      >
        Stop
      </button>
      {stop.isError && (
        <span className="isl-rec-error" role="alert">
          Couldn’t stop. {stop.error.message}
        </span>
      )}
    </div>
  );
}
