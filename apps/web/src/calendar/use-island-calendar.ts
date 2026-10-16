import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chime, ChimeHold } from '../island/island-sound.ts';
import { calendarApi } from './calendar-api.ts';
import {
  calendarLine,
  NO_HELD,
  tallyHeld,
  type CalendarLine,
  type CatchUp,
  type HeldTally,
} from './island-calendar.ts';
import { openJoin, todayState } from './today-model.ts';
import { useCalendarNow, useCalendarStatus } from './use-calendar.ts';

const DISMISSED_KEY = 'spark-outpost.calendar-capture-dismissed';
const DISMISSED_MAX = 50;

function readDismissed(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys].slice(-DISMISSED_MAX)));
  } catch {
    return;
  }
}

export interface IslandCalendar {
  line: CalendarLine | null;
  hold: ChimeHold;
  onJoin: (line: CalendarLine) => void;
  onCapture: (line: CalendarLine) => void;
  onDismiss: (line: CalendarLine) => void;
}

function useHeldChimes(holdLabel: string | null) {
  const [tally, setTally] = useState<HeldTally>(NO_HELD);
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  const label = useRef<string | null>(null);
  const counted = useRef<HeldTally>(NO_HELD);
  useEffect(() => {
    counted.current = tally;
  }, [tally]);
  useEffect(() => {
    if (holdLabel) {
      label.current = holdLabel;
      return;
    }
    if (!label.current) return;
    const ended = { label: label.current, tally: counted.current };
    label.current = null;
    setTally(NO_HELD);
    setCatchUp(ended);
  }, [holdLabel]);
  const onHeld = useCallback(
    (chime: Chime) => setTally((current) => tallyHeld(current, chime)),
    [],
  );
  const hold = useMemo(() => ({ held: holdLabel !== null, onHeld }), [holdLabel, onHeld]);
  return { hold, catchUp, clearCatchUp: () => setCatchUp(null) };
}

export function useIslandCalendar(
  at: number,
  waiting: number,
  onQuickChat: (text: string) => void,
): IslandCalendar {
  const status = useCalendarStatus();
  const ready = status.data !== undefined && todayState(status.data) === 'ready';
  const now = useCalendarNow(ready).data ?? null;
  const live = ready ? now : null;
  const holdLabel = live?.hold ? (live.hold.focus ? 'Focus' : live.hold.title) : null;
  const held = useHeldChimes(holdLabel);
  const [dismissed, setDismissed] = useState(readDismissed);
  const dismiss = (key: string) =>
    setDismissed((current) => {
      const next = new Set(current).add(key);
      saveDismissed(next);
      return next;
    });
  const line = calendarLine({ now: live, at, waiting, catchUp: held.catchUp, dismissed });
  return {
    line,
    hold: held.hold,
    onJoin: (shown) => {
      if (shown.join) openJoin(shown.join.url);
    },
    onDismiss: (shown) => {
      if (shown.dismiss === 'catch_up') held.clearCatchUp();
      if (shown.capture) dismiss(shown.capture.eventKey);
    },
    onCapture: (shown) => {
      const capture = shown.capture;
      if (!capture) return;
      dismiss(capture.eventKey);
      void calendarApi
        .detail({ eventId: capture.eventId, start: capture.start })
        .then((detail) => detail.notes.trim())
        .catch(() => '')
        .then((notes) =>
          onQuickChat(`Follow up on ${capture.title}${notes ? `\n\n${notes}` : ''}`),
        );
    },
  };
}
