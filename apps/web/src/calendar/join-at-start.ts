import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { spanOf, type CalendarEvent, type CalendarNow } from '@spark-outpost/contracts';
import { calendarApi, calendarKeys } from './calendar-api.ts';

export type AskedJoins = ReadonlyMap<string, boolean>;

const NO_ASKED: AskedJoins = new Map();

export function canAskJoinAtStart(event: CalendarEvent, at: number): boolean {
  return event.link !== null && !event.allDay && at < spanOf(event).start;
}

function flagged(event: CalendarEvent, asked: AskedJoins): CalendarEvent {
  const want = asked.get(event.key);
  return want === undefined || want === event.joinAtStart ? event : { ...event, joinAtStart: want };
}

export function withAsked(live: CalendarNow | null, asked: AskedJoins): CalendarNow | null {
  if (!live || asked.size === 0) return live;
  const nudge =
    live.nudge && live.nudge.kind !== 'wrap_up'
      ? { ...live.nudge, group: live.nudge.group.map((event) => flagged(event, asked)) }
      : live.nudge;
  return { ...live, upcoming: live.upcoming.map((event) => flagged(event, asked)), nudge };
}

export function useJoinAtStart() {
  const queryClient = useQueryClient();
  const [asked, setAsked] = useState<AskedJoins>(NO_ASKED);
  const save = useCallback(
    (event: Pick<CalendarEvent, 'key' | 'end'>, on: boolean) => {
      setAsked((current) => new Map(current).set(event.key, on));
      void calendarApi
        .mark({ eventKey: event.key, end: event.end, kind: 'join_at_start', on })
        .catch(() => undefined)
        .finally(() => void queryClient.invalidateQueries({ queryKey: calendarKeys.all }));
    },
    [queryClient],
  );
  return { asked, save };
}
