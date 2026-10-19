import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent } from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import type { Chime, ChimeHold } from '../island/island-sound.ts';
import { calendarApi } from './calendar-api.ts';
import {
  calendarLine,
  hopKeys,
  NO_HELD,
  tallyHeld,
  type CalendarLine,
  type CatchUp,
  type HeldTally,
} from './island-calendar.ts';
import { eventEnds, stillOn, useEventClock } from './event-clock.ts';
import {
  dismissNudge,
  NO_NUDGE_MARKS,
  purgeMarks,
  snoozeEnds,
  snoozeNudge,
  type NudgeMarks,
} from './nudge-marks.ts';
import { todayState } from './today-model.ts';
import { openTodayEvent } from './today-request.ts';
import { useCalendarNow, useCalendarStatus } from './use-calendar.ts';

const NO_MEETINGS: readonly CalendarEvent[] = [];
const NO_CLASHES: ReadonlyMap<string, readonly string[]> = new Map();

function openToday(eventKey: string): void {
  const desktop = sparkDesktop();
  if (desktop?.island.openSettings) desktop.island.openSettings(`today:${eventKey}`);
  else openTodayEvent(eventKey);
}

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
  connected: boolean;
  line: CalendarLine | null;
  hold: ChimeHold;
  at: number;
  upcoming: readonly CalendarEvent[];
  clashes: ReadonlyMap<string, readonly string[]>;
  choosing: readonly CalendarEvent[] | null;
  calendarName: (event: CalendarEvent) => string;
  hopKeys: string[];
  onOpenEvent: (eventKey: string) => void;
  onChoose: (line: CalendarLine) => void;
  onCapture: (line: CalendarLine) => void;
  onDismiss: (line: CalendarLine) => void;
  onSnooze: (event: CalendarEvent) => void;
  onDismissNudge: (event: CalendarEvent) => void;
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

export interface IslandHomePanel {
  open: boolean;
  show: () => void;
}

function useChoosing(home: IslandHomePanel) {
  const [choosing, setChoosing] = useState<readonly CalendarEvent[] | null>(null);
  const [wasOpen, setWasOpen] = useState(home.open);
  if (wasOpen !== home.open) {
    setWasOpen(home.open);
    if (!home.open) setChoosing(null);
  }
  const choose = (line: CalendarLine) => {
    if (!line.choose) return;
    setChoosing(line.choose);
    home.show();
  };
  return { choosing: home.open ? choosing : null, choose };
}

function useNudgeClock(live: ReturnType<typeof useCalendarNow>['data'] | null, updatedAt: number) {
  const [marks, setMarks] = useState<NudgeMarks>(NO_NUDGE_MARKS);
  const times = useMemo(() => {
    const nudged = live?.nudge && live.nudge.kind !== 'wrap_up' ? live.nudge.group : [];
    return [...eventEnds([...(live?.upcoming ?? []), ...nudged]), ...snoozeEnds(marks)];
  }, [live, marks]);
  const clock = useEventClock(times, updatedAt);
  const kept = purgeMarks(marks, clock);
  if (kept !== marks) setMarks(kept);
  return { marks: kept, clock, setMarks };
}

export function useIslandCalendar(
  minute: number,
  waiting: number,
  onQuickChat: (text: string) => void,
  home: IslandHomePanel,
): IslandCalendar {
  const status = useCalendarStatus();
  const ready = status.data !== undefined && todayState(status.data) === 'ready';
  const nowQuery = useCalendarNow(ready);
  const live = ready ? (nowQuery.data ?? null) : null;
  const nudges = useNudgeClock(live, nowQuery.dataUpdatedAt);
  const at = Math.max(minute, nudges.clock);
  const holdLabel = live?.hold ? (live.hold.focus ? 'Focus' : live.hold.title) : null;
  const held = useHeldChimes(holdLabel);
  const [dismissed, setDismissed] = useState(readDismissed);
  const dismiss = (key: string) =>
    setDismissed((current) => {
      const next = new Set(current).add(key);
      saveDismissed(next);
      return next;
    });
  const line = calendarLine({
    now: live,
    at,
    waiting,
    catchUp: held.catchUp,
    dismissed,
    marks: nudges.marks,
  });
  const { choosing, choose } = useChoosing(home);
  const clashes = useMemo(
    () =>
      live ? new Map(live.clashes.map((clash) => [clash.eventKey, clash.titles])) : NO_CLASHES,
    [live],
  );
  const names = useMemo(
    () => new Map((live?.calendars ?? []).map((choice) => [choice.key, choice.title])),
    [live],
  );
  return {
    connected: ready,
    line,
    hold: held.hold,
    at,
    upcoming: live ? stillOn(live.upcoming, at) : NO_MEETINGS,
    clashes,
    choosing,
    calendarName: (event) => names.get(event.calendarKey) ?? 'Calendar',
    hopKeys: hopKeys(live),
    onOpenEvent: (eventKey) => openToday(eventKey),
    onChoose: choose,
    onSnooze: (event) =>
      nudges.setMarks((current) =>
        snoozeNudge(current, event.key, Date.parse(event.end), Date.now()),
      ),
    onDismissNudge: (event) =>
      nudges.setMarks((current) => dismissNudge(current, event.key, Date.parse(event.end))),
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
