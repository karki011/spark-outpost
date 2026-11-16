import type { CSSProperties } from 'react';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import { compactCard } from '../calendar/meeting-card.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { JoinButton } from '../calendar/JoinButton.tsx';
import { CardButton, MeetingCardBody } from '../calendar/card/MeetingCard.tsx';
import { MeetingChoices } from '../calendar/MeetingChoices.tsx';
import { ClockIcon } from '../ui/icons.tsx';
import { CalendarBubble } from './CalendarBubble.tsx';
import { useLeave } from './use-leave.ts';

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
  if (line.meeting) {
    return <CalendarCardLine key={line.key} line={line} top={top} calendar={calendar} />;
  }
  return <CalendarRestLine key={line.key} line={line} top={top} calendar={calendar} />;
}

function CalendarCardLine({ line, top, calendar }: CalendarRestLineProps) {
  const { leaving, leave } = useLeave();
  const meeting = line.meeting!;
  const dismiss = () => leave(() => calendar.onDismiss(line));
  const choices = line.choose;
  return (
    <div
      className="isl-restline isl-meet mc"
      data-kind="calendar"
      data-leaving={leaving || undefined}
      role="group"
      aria-label={`${meeting.lead}: ${meeting.title}`}
      style={{ '--line-top': `${top}px` } as CSSProperties}
      onKeyDown={(key) => {
        if (key.key !== 'Escape') return;
        key.preventDefault();
        key.stopPropagation();
        dismiss();
      }}
    >
      <MeetingCardBody
        kicker={meeting.lead}
        ended={line.kind === 'capture'}
        title={meeting.title}
        rows={[{ key: 'sub', icon: <ClockIcon />, text: meeting.sub }]}
        list={
          choices ? (
            <MeetingChoices
              meetings={choices}
              now={calendar.at}
              calendarName={calendar.calendarName}
              onOpen={(event) => calendar.onOpenEvent(event.key)}
              onJoined={(event) => calendar.onJoined(event.key)}
              buttonClass={{ join: 'mc-btn primary', open: 'mc-btn' }}
            />
          ) : null
        }
        closeLabel={meetingDismissLabel(line)}
        onClose={dismiss}
      >
        {line.join && (
          <JoinButton
            event={line.join}
            now={calendar.at}
            className="mc-btn primary"
            plain
            onJoined={(event) => calendar.onJoined(event.key)}
          />
        )}
        {line.capture && (
          <CardButton primary label="Open notes" onClick={() => calendar.onCapture(line)} />
        )}
      </MeetingCardBody>
    </div>
  );
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
      title={line.text}
      style={{ '--line-top': `${top}px` } as CSSProperties}
    >
      <span className="isl-restline-dot" aria-hidden="true" />
      <span className="isl-restline-text">{line.text}</span>
      {line.join && (
        <JoinButton
          event={line.join}
          now={calendar.at}
          className="isl-calline-act primary"
          plain
          onJoined={(event) => calendar.onJoined(event.key)}
        />
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
