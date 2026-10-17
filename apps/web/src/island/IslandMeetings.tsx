import { joinOpen, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { clock } from '../calendar/calendar-format.ts';
import { MeetingChoices } from '../calendar/MeetingChoices.tsx';
import { openJoin } from '../calendar/today-model.ts';
import { VideoIcon } from '../ui/icons.tsx';

export const ISLAND_MEETINGS = 3;

function MeetingRow({ event, calendar }: { event: CalendarEvent; calendar: IslandCalendar }) {
  const { start, end } = spanOf(event);
  const link = event.link;
  const joinable = link !== null && joinOpen({ start, end }, calendar.at);
  return (
    <li>
      <button
        type="button"
        className="isl-meet-row"
        title={event.title}
        onClick={() => calendar.onOpenEvent(event.key)}
      >
        <time>{clock(start)}</time>
        <span>{event.title}</span>
      </button>
      <ClashTag titles={calendar.clashes.get(event.key)} />
      {joinable && (
        <button
          type="button"
          className="isl-meet-join"
          aria-label={`Join ${event.title}`}
          title={`Join ${event.title}`}
          onClick={() => openJoin(link.url)}
        >
          <VideoIcon />
        </button>
      )}
    </li>
  );
}

function ChooseMeeting({
  calendar,
  meetings,
}: {
  calendar: IslandCalendar;
  meetings: readonly CalendarEvent[];
}) {
  return (
    <section className="isl-hcard isl-meet isl-choose" aria-labelledby="isl-choose-h">
      <h3 id="isl-choose-h">Choose a meeting</h3>
      <MeetingChoices
        meetings={meetings}
        now={calendar.at}
        calendarName={calendar.calendarName}
        onOpen={(event) => calendar.onOpenEvent(event.key)}
        buttonClass={{ join: 'isl-choose-act primary', open: 'isl-choose-act' }}
        focusFirst
      />
    </section>
  );
}

export function IslandMeetings({ calendar }: { calendar: IslandCalendar }) {
  if (calendar.choosing) return <ChooseMeeting calendar={calendar} meetings={calendar.choosing} />;
  const meetings = calendar.upcoming.slice(0, ISLAND_MEETINGS);
  if (meetings.length === 0) return null;
  return (
    <section className="isl-hcard isl-meet" aria-labelledby="isl-meet-h">
      <h3 id="isl-meet-h">Next meetings</h3>
      <ul>
        {meetings.map((event) => (
          <MeetingRow key={event.key} event={event} calendar={calendar} />
        ))}
      </ul>
    </section>
  );
}
