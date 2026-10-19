import { useEffect } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CalendarChoicePatch,
  CalendarEvent,
  CalendarSettingsPatch,
  CalendarStatus,
} from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { calendarApi, calendarKeys } from './calendar-api.ts';
import { todayState, type TodayState } from './today-model.ts';

const NOW_EVERY_MS = 30_000;

export function useCalendarStatus(refetchInterval: number | false = false) {
  const { remote } = useRemoteClient();
  const query = useQuery({
    queryKey: calendarKeys.status,
    queryFn: calendarApi.status,
    enabled: !remote,
    refetchInterval,
  });
  const { refetch } = query;
  useEffect(() => {
    if (remote) return;
    const recheck = () => void refetch();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [remote, refetch]);
  return query;
}

export function useCalendarState(): { state: TodayState | null; status: CalendarStatus | null } {
  const status = useCalendarStatus();
  const data = status.data ?? null;
  return { state: data ? todayState(data) : null, status: data };
}

export function useCalendarNow(enabled: boolean) {
  return useQuery({
    queryKey: calendarKeys.now,
    queryFn: calendarApi.now,
    enabled,
    refetchInterval: NOW_EVERY_MS,
  });
}

export function useCalendarDay(date: string, enabled: boolean) {
  return useQuery({
    queryKey: calendarKeys.day(date),
    queryFn: () => calendarApi.day(date),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCalendarRange(from: string, to: string) {
  return useQuery({
    queryKey: calendarKeys.range(from, to),
    queryFn: () => calendarApi.range(from, to),
    placeholderData: keepPreviousData,
  });
}

const DETAIL_STALE_MS = 5 * 60_000;

function wantsDetail(event: CalendarEvent): boolean {
  return event.hasNotes || event.attendeeCount > 1;
}

export function useEventDetail(event: CalendarEvent) {
  const occurrence = { eventId: event.id, start: event.start, calendarKey: event.calendarKey };
  return useQuery({
    queryKey: calendarKeys.detail(occurrence),
    queryFn: () => calendarApi.detail(occurrence),
    enabled: wantsDetail(event),
    staleTime: DETAIL_STALE_MS,
    retry: false,
  });
}

export function localDate(at: number): string {
  const day = new Date(at);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`;
}

export function useCalendarActions() {
  const queryClient = useQueryClient();
  const settle = (status: CalendarStatus) => {
    queryClient.setQueryData(calendarKeys.status, status);
    void queryClient.invalidateQueries({
      queryKey: calendarKeys.all,
      predicate: (query) => query.queryKey[1] !== 'status',
    });
  };
  const connect = useMutation({ mutationFn: calendarApi.connect, onSuccess: settle });
  const disconnect = useMutation({ mutationFn: calendarApi.disconnect, onSuccess: settle });
  const choose = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: CalendarChoicePatch }) =>
      calendarApi.choose(key, patch),
    onSuccess: settle,
  });
  const settings = useMutation({
    mutationFn: (patch: CalendarSettingsPatch) => calendarApi.saveSettings(patch),
    onSuccess: (saved) => {
      queryClient.setQueryData<CalendarStatus>(calendarKeys.status, (current) =>
        current ? { ...current, settings: saved } : current,
      );
      void queryClient.invalidateQueries({ queryKey: calendarKeys.now });
    },
  });
  return { connect, disconnect, choose, settings };
}

export function useOpenCalendarSettings() {
  return useMutation({ mutationFn: calendarApi.openSettings });
}
