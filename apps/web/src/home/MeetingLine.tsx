import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { clock } from '../calendar/calendar-format.ts';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { JoinButton } from '../calendar/JoinButton.tsx';
import { openTodayEvent } from '../calendar/today-request.ts';
import type { Upcoming } from '../calendar/use-upcoming.ts';
import type { MeetingLead } from './use-meeting-lead.ts';

interface MeetingLineProps {
  day: Upcoming;
  meeting: MeetingLead;
  now: number;
}

function nextToday(events: readonly CalendarEvent[], now: number): CalendarEvent | null {
  return events.find((event) => spanOf(event).end > now) ?? null;
}

export function MeetingLine({ day, meeting, now }: MeetingLineProps) {
  if (!day.available) return null;
  const { event } = meeting;
  if (event) {
    return (
      <div className="home-meet live" role="group" aria-label={`Meeting: ${event.title}`}>
        <span className="home-meet-t">
          <b>{event.title}</b> {clock(spanOf(event).start)}{' '}
          <ClashTag titles={day.clashes.get(event.key)} />
        </span>
        <button type="button" className="btn sm ghost" onClick={() => meeting.dismiss(event)}>
          Dismiss
        </button>
        <button type="button" className="btn sm line" onClick={() => meeting.snooze(event)}>
          Snooze 1 min
        </button>
        <JoinButton event={event} now={now} onJoined={meeting.joined} notes />
      </div>
    );
  }
  const next = nextToday(day.events, now);
  if (!next) return null;
  return (
    <button
      type="button"
      className="home-meet hlink"
      aria-label={`Next meeting: ${next.title} at ${clock(spanOf(next).start)}`}
      onClick={() => openTodayEvent(next.key)}
    >
      Next: {next.title} · {clock(spanOf(next).start)}
    </button>
  );
}
