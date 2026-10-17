import { joinOpen, spanOf } from '@spark-outpost/contracts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { clock } from '../calendar/calendar-format.ts';
import { openJoin } from '../calendar/today-model.ts';
import { VideoIcon } from '../ui/icons.tsx';

export const ISLAND_MEETINGS = 3;

export function IslandMeetings({ calendar }: { calendar: IslandCalendar }) {
  const meetings = calendar.upcoming.slice(0, ISLAND_MEETINGS);
  if (meetings.length === 0) return null;
  return (
    <section className="isl-hcard isl-meet" aria-labelledby="isl-meet-h">
      <h3 id="isl-meet-h">Next meetings</h3>
      <ul>
        {meetings.map((event) => {
          const { start, end } = spanOf(event);
          const joinable = event.link !== null && joinOpen({ start, end }, calendar.at);
          return (
            <li key={event.key}>
              <button
                type="button"
                className="isl-meet-row"
                title={event.title}
                onClick={() => calendar.onOpenEvent(event.key)}
              >
                <time>{clock(start)}</time>
                <span>{event.title}</span>
              </button>
              {joinable && event.link && (
                <button
                  type="button"
                  className="isl-meet-join"
                  aria-label={`Join ${event.title}`}
                  title={`Join ${event.title}`}
                  onClick={() => openJoin(event.link!.url)}
                >
                  <VideoIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
