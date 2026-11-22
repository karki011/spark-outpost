import './rail-recording.css';
import { openTodayMeeting } from '../calendar/today-request.ts';
import { useRecordingDetail } from '../meetings/index.ts';
import { LiveElapsed } from '../ui/LiveElapsed.tsx';

export function RailRecording({ id }: { id: string }) {
  const recording = useRecordingDetail(id);
  const label = `Recording ${recording.title}. Open transcript`;
  return (
    <button
      type="button"
      className="rail-rec"
      aria-label={label}
      title={label}
      onClick={() => openTodayMeeting(id)}
    >
      <span className="rail-rec-dot" aria-hidden="true" />
      <span className="rail-rec-word">Rec</span>
      {recording.startedAt !== null && (
        <LiveElapsed since={recording.startedAt} className="rail-rec-time" />
      )}
    </button>
  );
}
