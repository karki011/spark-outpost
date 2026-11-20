import { useCallback } from 'react';
import { useClockText } from '../ui/use-clock-text.ts';
import { finishedAt, waitingAge, type RowLine as Line } from './row-line.ts';

type TimedKind = Exclude<Line['kind'], 'doing'>;

function TimedLine({ kind, time }: { kind: TimedKind; time: number }) {
  const text = useClockText(
    useCallback(
      (now: number) => (kind === 'waiting' ? waitingAge(time, now) : finishedAt(time, now)),
      [kind, time],
    ),
  );
  return (
    <span className="row-line" data-line={kind} aria-hidden="true">
      {text}
    </span>
  );
}

export function RowLine({ line }: { line: Line | null }) {
  if (!line) return null;
  if (line.kind === 'doing') {
    return (
      <span className="row-line" data-line="doing" aria-hidden="true">
        {line.text}
      </span>
    );
  }
  return <TimedLine kind={line.kind} time={line.kind === 'waiting' ? line.since : line.at} />;
}
