import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { calendarApi, calendarKeys } from '../calendar/calendar-api.ts';
import { useJoinLeadMs } from '../calendar/use-calendar.ts';
import type { Upcoming } from '../calendar/use-upcoming.ts';
import { leadMeeting } from './meeting-lead.ts';

export const SNOOZE_MS = 60_000;

const hiddenUntil = new Map<string, number>();

export interface MeetingLead {
  event: CalendarEvent | null;
  snooze: (event: CalendarEvent) => void;
  dismiss: (event: CalendarEvent) => void;
  joined: (event: CalendarEvent) => void;
}

export function useMeetingLead(day: Upcoming, now: number): MeetingLead {
  const client = useQueryClient();
  const leadMs = useJoinLeadMs();
  const [clockNow, setClockNow] = useState(Date.now);
  const mark = useMutation({
    mutationFn: calendarApi.mark,
    onSettled: () => client.invalidateQueries({ queryKey: calendarKeys.now }),
  });
  const hide = useCallback((key: string, until: number) => {
    hiddenUntil.set(key, until);
    if (Number.isFinite(until)) setTimeout(() => setClockNow(Date.now()), until - Date.now() + 50);
    setClockNow(Date.now());
  }, []);
  const event = day.available
    ? leadMeeting(
        day.events,
        now,
        leadMs,
        (key) => Math.max(now, clockNow) < (hiddenUntil.get(key) ?? 0),
      )
    : null;
  return {
    event,
    snooze: (target) => hide(target.key, Date.now() + SNOOZE_MS),
    joined: (target) => hide(target.key, Infinity),
    dismiss: (target) => {
      hide(target.key, Infinity);
      mark.mutate({
        eventKey: target.key,
        end: new Date(spanOf(target).end).toISOString(),
        kind: 'dismiss',
        on: true,
      });
    },
  };
}
