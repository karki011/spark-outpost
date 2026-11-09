import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { clock } from '../calendar/calendar-format.ts';
import { canAskJoinAtStart } from '../calendar/join-at-start.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';

interface JoinAtStartActionProps {
  event: CalendarEvent;
  calendar: IslandCalendar;
  buttonClass: string;
  noteClass: string;
  offer: boolean;
}

export function JoinAtStartAction(props: JoinAtStartActionProps) {
  const { event, calendar } = props;
  const start = spanOf(event).start;
  if (event.joinAtStart && calendar.at < start) {
    return (
      <>
        <span className={props.noteClass}>Opens at {clock(start)}</span>
        <button
          type="button"
          className={props.buttonClass}
          aria-label={`Don't open ${event.title} at ${clock(start)}`}
          onClick={() => calendar.onCancelJoinAtStart(event)}
        >
          Don't open
        </button>
      </>
    );
  }
  if (!props.offer || !canAskJoinAtStart(event, calendar.at)) return null;
  return (
    <button
      type="button"
      className={props.buttonClass}
      aria-label={`Join at start: ${event.title}`}
      onClick={() => calendar.onJoinAtStart(event)}
    >
      Join at start
    </button>
  );
}
