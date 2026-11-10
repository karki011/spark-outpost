import { useMemo } from 'react';
import type { CalendarEvent } from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { eventEnds, stillOn, useEventClock } from './event-clock.ts';
import { useCalendarNow, useCalendarState } from './use-calendar.ts';

export interface Upcoming {
  pending: boolean;
  available: boolean;
  events: readonly CalendarEvent[];
  calendars: ReadonlyMap<string, string>;
  clashes: ReadonlyMap<string, readonly string[]>;
}

const NONE: readonly CalendarEvent[] = [];

export function useUpcoming(now: number): Upcoming {
  const { remote } = useRemoteClient();
  const { state, failed } = useCalendarState();
  const ready = !remote && state === 'ready';
  const query = useCalendarNow(ready);
  const calendars = useMemo(
    () => new Map((query.data?.calendars ?? []).map((choice) => [choice.key, choice.title])),
    [query.data],
  );
  const ends = useMemo(() => eventEnds(query.data?.upcoming ?? []), [query.data]);
  const clock = useEventClock(ends, query.dataUpdatedAt);
  const clashes = useMemo(
    () => new Map((query.data?.clashes ?? []).map((clash) => [clash.eventKey, clash.titles])),
    [query.data],
  );
  const events = useMemo(
    () => (query.data ? stillOn(query.data.upcoming, Math.max(now, clock)) : NONE),
    [query.data, now, clock],
  );
  return {
    pending: !remote && ((state === null && !failed) || (ready && !query.data && !query.isError)),
    available: ready && query.data !== undefined,
    events,
    calendars,
    clashes,
  };
}
