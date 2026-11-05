import { useEffect } from 'react';
import { localDate } from './use-calendar.ts';

export interface TodayEventRequest {
  eventKey: string;
  date: string | null;
}

let pending: TodayEventRequest | null = null;
const listeners = new Set<() => void>();
const appOpeners = new Set<() => void>();

export function eventDate(eventKey: string): string | null {
  const at = Date.parse(eventKey.slice(eventKey.lastIndexOf('@') + 1));
  return Number.isNaN(at) ? null : localDate(at);
}

export function openTodayEvent(eventKey: string): void {
  pending = { eventKey, date: eventDate(eventKey) };
  appOpeners.forEach((open) => open());
  listeners.forEach((listener) => listener());
}

function takeTodayEvent(): TodayEventRequest | null {
  const asked = pending;
  pending = null;
  return asked;
}

export function useTodayOpener(open: () => void): void {
  useEffect(() => {
    appOpeners.add(open);
    return () => {
      appOpeners.delete(open);
    };
  }, [open]);
}

export function useTodayEventRequests(select: (request: TodayEventRequest) => void): void {
  useEffect(() => {
    const take = () => {
      const request = takeTodayEvent();
      if (request) select(request);
    };
    take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [select]);
}
