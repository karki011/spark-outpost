import { useEffect, useRef } from 'react';
import type { CalendarEvent } from '@spark-outpost/contracts';
import { hasModifier } from '../ui/shortcuts.ts';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { joinTarget, openJoin, todayState } from './today-model.ts';
import { useCalendarNow, useCalendarStatus } from './use-calendar.ts';

function isJoinShortcut(event: KeyboardEvent): boolean {
  return hasModifier(event) && !event.shiftKey && !event.altKey && event.code === 'KeyJ';
}

function useJoinShortcut(upcoming: readonly CalendarEvent[]): void {
  const latest = useRef(upcoming);
  useEffect(() => {
    latest.current = upcoming;
  }, [upcoming]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isJoinShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = joinTarget(latest.current, Date.now());
      if (!target?.link) return;
      event.preventDefault();
      openJoin(target.link.url);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

const NONE: readonly CalendarEvent[] = [];

export function useCalendarShell(
  remote: boolean,
  startChat: (text: string) => void,
): (text: string) => void {
  const status = useCalendarStatus();
  const ready = !remote && status.data !== undefined && todayState(status.data) === 'ready';
  const now = useCalendarNow(ready);
  useJoinShortcut(ready ? (now.data?.upcoming ?? NONE) : NONE);
  return useStableCallback(startChat);
}
