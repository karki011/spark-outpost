import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, CalendarNow } from '@spark-outpost/contracts';
import { hasModifier } from '../ui/shortcuts.ts';
import { ChooseMeetingDialog } from './ChooseMeetingDialog.tsx';
import { joinChoice } from './join-choice.ts';
import { openJoin, todayState } from './today-model.ts';
import { useCalendarNow, useCalendarStatus, useJoinLeadMs } from './use-calendar.ts';

function isJoinShortcut(event: KeyboardEvent): boolean {
  return hasModifier(event) && !event.shiftKey && !event.altKey && event.code === 'KeyJ';
}

interface Choosing {
  meetings: CalendarEvent[];
  at: number;
}

function useJoinShortcut(now: CalendarNow | null, choose: (choosing: Choosing) => void) {
  const leadMs = useJoinLeadMs();
  const latest = useRef({ now, choose, leadMs });
  useEffect(() => {
    latest.current = { now, choose, leadMs };
  }, [now, choose, leadMs]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isJoinShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const at = Date.now();
      const choice = joinChoice(latest.current.now, at, latest.current.leadMs);
      if (!choice) return;
      event.preventDefault();
      if ('join' in choice) {
        if (choice.join.link) openJoin(choice.join.link.url);
        return;
      }
      latest.current.choose({ meetings: choice.choose, at });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

interface JoinShortcutProps {
  remote: boolean;
  onOpenEvent: (eventKey: string) => void;
}

export function JoinShortcut({ remote, onOpenEvent }: JoinShortcutProps) {
  const status = useCalendarStatus();
  const ready = !remote && status.data !== undefined && todayState(status.data) === 'ready';
  const now = useCalendarNow(ready).data ?? null;
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  useJoinShortcut(ready ? now : null, setChoosing);
  const names = useMemo(
    () => new Map((now?.calendars ?? []).map((choice) => [choice.key, choice.title])),
    [now],
  );
  if (!choosing) return null;
  return (
    <ChooseMeetingDialog
      meetings={choosing.meetings}
      now={choosing.at}
      calendarName={(event) => names.get(event.calendarKey) ?? 'Calendar'}
      onOpen={(event) => onOpenEvent(event.key)}
      onClose={() => setChoosing(null)}
    />
  );
}
