import { joinOpen, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { span } from '../calendar/calendar-format.ts';
import { joinLabel, startsLabel } from '../calendar/meeting-card.ts';
import { MeetingChoices } from '../calendar/MeetingChoices.tsx';
import { openJoin } from '../calendar/today-model.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { VideoIcon, XIcon } from '../ui/icons.tsx';

function NextMeeting({ event, calendar }: { event: CalendarEvent; calendar: IslandCalendar }) {
  const { start, end } = spanOf(event);
  const link = event.link;
  const joinable = link !== null && joinOpen({ start, end }, calendar.at);
  return (
    <section
      className="isl-inbox-meet"
      aria-label="Next meeting"
      data-joinable={joinable || undefined}
    >
      <button
        type="button"
        className="isl-inbox-meet-open"
        title={`Open ${event.title} in Today`}
        onClick={() => calendar.onOpenEvent(event.key)}
      >
        <VideoIcon />
        <b>{event.title}</b>
        <span>
          · {startsLabel(event, calendar.at).toLowerCase()} · {span(start, end)}
        </span>
      </button>
      <ClashTag titles={calendar.clashes.get(event.key)} />
      {joinable && (
        <button
          type="button"
          className="isl-btn primary"
          data-in-place
          aria-label={`${joinLabel(event)}: ${event.title}`}
          onClick={() => {
            openJoin(link.url);
            calendar.onJoined(event.key);
          }}
        >
          Join
        </button>
      )}
      <button
        type="button"
        className="isl-inbox-x"
        data-in-place
        title="Dismiss"
        aria-label={`Dismiss the alert for ${event.title}`}
        onClick={() => calendar.onDismissNudge(event)}
      >
        <XIcon />
      </button>
    </section>
  );
}

export function InboxMeeting({ calendar }: { calendar: IslandCalendar }) {
  if (calendar.choosing) {
    return (
      <section className="isl-inbox-choose" aria-labelledby="isl-choose-h">
        <h3 id="isl-choose-h">Choose a meeting</h3>
        <MeetingChoices
          meetings={calendar.choosing}
          now={calendar.at}
          calendarName={calendar.calendarName}
          onOpen={(event) => calendar.onOpenEvent(event.key)}
          onJoined={(event) => calendar.onJoined(event.key)}
          buttonClass={{ join: 'isl-btn primary', open: 'isl-btn' }}
          focusFirst
        />
      </section>
    );
  }
  const next = calendar.connected ? calendar.upcoming[0] : undefined;
  return next ? <NextMeeting event={next} calendar={calendar} /> : null;
}
