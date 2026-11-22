import './island-recording.css';
import type { CSSProperties } from 'react';
import { useRecordingDetail, useStopMeeting } from '../meetings/index.ts';
import { LiveElapsed } from '../ui/LiveElapsed.tsx';

const SHORT_WAVE = [0.45, 0.8, 1, 0.6, 0.9, 0.5, 0.7];
const LONG_WAVE = [
  0.3, 0.5, 0.75, 0.45, 0.9, 1, 0.6, 0.85, 0.4, 0.7, 1, 0.8, 0.5, 0.9, 0.65, 0.35, 0.55, 0.3,
];

function RecordingWave({ peaks }: { peaks: readonly number[] }) {
  return (
    <span className="isl-rec-wave" aria-hidden="true">
      {peaks.map((peak, bar) => (
        <i key={bar} style={{ '--bar': bar, '--peak': peak } as CSSProperties} />
      ))}
    </span>
  );
}

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
      <span className="isl-rec-status">
        <RecordingWave peaks={SHORT_WAVE} />
        <span className="isl-rec-word">Recording</span>
        {recording.startedAt !== null && (
          <LiveElapsed since={recording.startedAt} className="isl-rec-time" />
        )}
      </span>
      <button type="button" className="isl-rec-title" onClick={() => onOpen(id)}>
        {recording.title}
      </button>
      {variant === 'line' && (
        <button type="button" className="isl-btn isl-rec-open" onClick={() => onOpen(id)}>
          Open transcript
        </button>
      )}
      <button
        type="button"
        className="isl-btn deny isl-rec-stop"
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

export function RestRecording({ hidden }: { hidden: number }) {
  return (
    <span
      className="isl-rec-tag"
      aria-hidden="true"
      style={{ '--rec-hidden': `${hidden}px` } as CSSProperties}
    >
      <RecordingWave peaks={LONG_WAVE} />
    </span>
  );
}
