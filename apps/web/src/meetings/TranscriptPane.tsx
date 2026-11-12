import { useLayoutEffect, useRef, type UIEvent } from 'react';
import { MEETING_SPEAKER_LABELS, type Meeting } from '@spark-outpost/contracts';
import { SpinnerIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { formatOffset } from './meeting-format.ts';
import { useMeetingLines } from './use-meeting-lines.ts';

const BOTTOM_SLACK_PX = 48;
const TOP_TRIGGER_PX = 80;

export function TranscriptPane({ meeting }: { meeting: Meeting }) {
  const { lines, query, hasEarlier, loadingEarlier, loadEarlier } = useMeetingLines(
    meeting.id,
    meeting.lineCount,
  );
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const anchor = useRef<{ firstSeq: number; height: number } | null>(null);
  const firstSeq = lines[0]?.seq;
  const lastSeq = lines.at(-1)?.seq;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const pending = anchor.current;
    if (pending && firstSeq !== undefined && firstSeq < pending.firstSeq) {
      element.scrollTop += element.scrollHeight - pending.height;
      anchor.current = null;
      return;
    }
    if (following.current) element.scrollTop = element.scrollHeight;
  }, [firstSeq, lastSeq]);

  function requestEarlier() {
    const element = scroller.current;
    if (!element || !hasEarlier || loadingEarlier) return;
    anchor.current = { firstSeq: firstSeq ?? 0, height: element.scrollHeight };
    void loadEarlier();
  }

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    following.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;
    if (element.scrollTop < TOP_TRIGGER_PX) requestEarlier();
  }

  if (query.data === undefined) {
    return (
      <QueryWait query={query} what="the transcript">
        <Skeleton label="Loading the transcript" rows={5} />
      </QueryWait>
    );
  }
  if (lines.length === 0) {
    return (
      <p className="mt-hint">
        {meeting.state === 'recording'
          ? 'Listening. Lines appear here as people speak.'
          : 'No speech was transcribed.'}
      </p>
    );
  }

  return (
    <div className="mt-transcript" ref={scroller} onScroll={onScroll}>
      {hasEarlier && (
        <button
          type="button"
          className="btn ghost sm mt-earlier"
          disabled={loadingEarlier}
          onClick={requestEarlier}
        >
          {loadingEarlier && <SpinnerIcon />}
          Load earlier lines
        </button>
      )}
      <ol className="mt-lines" aria-label="Transcript">
        {lines.map((line) => (
          <li key={line.seq} className="mt-line">
            <span className="mt-who">{MEETING_SPEAKER_LABELS[line.speaker]}</span>
            <time className="mt-time">{formatOffset(line.startMs)}</time>
            <span className="mt-text">{line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
