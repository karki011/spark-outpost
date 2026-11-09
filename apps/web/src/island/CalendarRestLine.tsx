import type { CSSProperties } from 'react';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import { compactCard } from '../calendar/meeting-card.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { JoinButton } from '../calendar/JoinButton.tsx';
import { CalendarBubble } from './CalendarBubble.tsx';

interface CalendarRestLineProps {
  line: CalendarLine;
  top: number;
  calendar: IslandCalendar;
}

export function CalendarLineView({ line, top, calendar }: CalendarRestLineProps) {
  const speaks = line.event !== null && line.choose === null;
  if (speaks && line.event) {
    return (
      <CalendarBubble
        key={line.event.key}
        event={line.event}
        top={top}
        calendar={calendar}
        compact={compactCard(window.screen.width, false)}
      />
    );
  }
  return <CalendarRestLine key={line.key} line={line} top={top} calendar={calendar} />;
}

function meetingDismissLabel(line: CalendarLine): string {
  if (line.choose) {
    return `Dismiss ${line.choose.length} meetings: ${line.choose.map((event) => event.title).join(', ')}`;
  }
  return `Dismiss the nudge for ${line.meeting?.title ?? line.text}`;
}

function CalendarRestLine({ line, top, calendar }: CalendarRestLineProps) {
  return (
    <div
      className="isl-restline isl-calline"
      data-kind="calendar"
      data-two={line.meeting ? true : undefined}
      title={line.text}
      style={{ '--line-top': `${top}px` } as CSSProperties}
    >
      <span className="isl-restline-dot" aria-hidden="true" />
      {line.meeting ? (
        <span className="isl-calline-two">
          <span className="isl-calline-head">
            <b className="isl-calline-lead">{line.meeting.lead}</b>
            <span className="isl-calline-sep"> · </span>
            <span className="isl-calline-title">{line.meeting.title}</span>
          </span>
          <span className="isl-calline-sub">{line.meeting.sub}</span>
        </span>
      ) : (
        <span className="isl-restline-text">{line.text}</span>
      )}
      {line.join && (
        <JoinButton
          event={line.join}
          now={calendar.at}
          className="isl-calline-act primary"
          plain
          onJoined={(event) => calendar.onJoined(event.key)}
        />
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
      {line.dismiss === 'join_at_start' && (
        <button
          type="button"
          className="isl-calline-act"
          aria-label={`Cancel: ${line.text}`}
          onClick={() => calendar.onDismiss(line)}
        >
          Cancel
        </button>
      )}
      {line.dismiss === 'meeting' && (
        <button
          type="button"
          className="isl-calline-act"
          aria-label={meetingDismissLabel(line)}
          onClick={() => calendar.onDismiss(line)}
        >
          Dismiss
        </button>
      )}
      {(line.dismiss === 'catch_up' || line.dismiss === 'capture') && (
        <button type="button" className="isl-calline-act" onClick={() => calendar.onDismiss(line)}>
          Dismiss
        </button>
      )}
    </div>
  );
}
