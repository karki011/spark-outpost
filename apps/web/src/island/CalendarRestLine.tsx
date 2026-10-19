import type { CSSProperties } from 'react';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { JoinButton } from '../calendar/JoinButton.tsx';
import { CalendarBubble } from './CalendarBubble.tsx';
import './island-bubble.css';

interface CalendarRestLineProps {
  line: CalendarLine;
  top: number;
  calendar: IslandCalendar;
}

export function CalendarLineView({ line, top, calendar }: CalendarRestLineProps) {
  const speaks = line.event !== null && line.choose === null;
  if (speaks && line.event) {
    return <CalendarBubble key={line.event.key} event={line.event} top={top} calendar={calendar} />;
  }
  return <CalendarRestLine key={line.key} line={line} top={top} calendar={calendar} />;
}

function CalendarRestLine({ line, top, calendar }: CalendarRestLineProps) {
  return (
    <div
      className="isl-restline isl-calline"
      data-kind="calendar"
      title={line.text}
      style={{ '--line-top': `${top}px` } as CSSProperties}
    >
      <span className="isl-restline-dot" aria-hidden="true" />
      <span className="isl-restline-text">{line.text}</span>
      {line.join && (
        <JoinButton event={line.join} now={calendar.at} className="isl-calline-act primary" plain />
      )}
      {line.choose && (
        <button
          type="button"
          className="isl-calline-act primary"
          aria-label={`Choose one of ${line.choose.length} meetings`}
          onClick={() => calendar.onChoose(line)}
        >
          Choose
        </button>
      )}
      {line.capture && (
        <button
          type="button"
          className="isl-calline-act primary"
          onClick={() => calendar.onCapture(line)}
        >
          Start a chat
        </button>
      )}
      {line.dismiss && (
        <button type="button" className="isl-calline-act" onClick={() => calendar.onDismiss(line)}>
          Dismiss
        </button>
      )}
    </div>
  );
}
