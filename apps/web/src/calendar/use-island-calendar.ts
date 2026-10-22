import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  joinOpen,
  spanOf,
  type CalendarEvent,
  type ConversationSummary,
  type MeetingCountdown,
} from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import type { Chime, ChimeHold } from '../island/island-sound.ts';
import { calendarApi, calendarKeys } from './calendar-api.ts';
import {
  calendarLine,
  chatStates,
  hopKeys,
  NO_HELD,
  tallyHeld,
  type CalendarLine,
  type CatchUp,
  type HeldTally,
} from './island-calendar.ts';
import { countdownSpans, eventEnds, stillOn, useEventClock } from './event-clock.ts';
import {
  dismissNudge,
  nudgeHidden,
  purgeMarks,
  readSnoozes,
  saveSnoozes,
  snoozeEnds,
  snoozeNudge,
  snoozeNudgeFor,
  withJoined,
  withServerDismissed,
  type NudgeMarks,
} from './nudge-marks.ts';
import { todayState } from './today-model.ts';
import { lineUnderAlert } from './meeting-alert.ts';
import { ALERT_SNOOZE_MS, useMeetingAlert } from './use-meeting-alert.ts';
import { openTodayEvent } from './today-request.ts';
import { useCalendarNow, useCalendarStatus } from './use-calendar.ts';
import { useIslandRequests } from '../island/island-requests.ts';

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
  onSnoozeAlert: (event: CalendarEvent) => void;
  onDismissNudge: (event: CalendarEvent) => void;
  countdown: MeetingCountdown | null;
  onCancelJoin: () => void;
  onJoinNow: () => void;
  onJoined: (eventKey: string) => void;
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
  note: (text: string) => void;
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

function stillChoosing(
  choosing: readonly CalendarEvent[] | null,
  marks: NudgeMarks,
  at: number,
): readonly CalendarEvent[] | null {
  if (!choosing) return null;
  const left = stillOn(choosing, at).filter((event) => !nudgeHidden(marks, event.key, at));
  return left.length > 0 ? left : null;
}

function useNudgeClock(live: ReturnType<typeof useCalendarNow>['data'] | null, updatedAt: number) {
  const [marks, setMarks] = useState<NudgeMarks>(() => readSnoozes(Date.now()));
  useEffect(() => saveSnoozes(marks), [marks]);
  const nudged = live?.nudge && live.nudge.kind !== 'wrap_up' ? live.nudge.group : null;
  const meetings = useMemo(() => [...(live?.upcoming ?? []), ...(nudged ?? [])], [live, nudged]);
  const times = useMemo(() => [...eventEnds(meetings), ...snoozeEnds(marks)], [meetings, marks]);
  const spans = useMemo(() => countdownSpans(meetings), [meetings]);
  const clock = useEventClock(times, updatedAt, spans);
  const kept = purgeMarks(marks, clock);
  if (kept !== marks) setMarks(kept);
  const saved = useMemo(
    () => withServerDismissed(kept, [...(live?.upcoming ?? []), ...(nudged ?? [])]),
    [kept, live, nudged],
  );
  return { marks: saved, clock, setMarks };
}

const MEETING_REQUESTS = ['snooze_meeting', 'join_meeting'] as const;

export const DISMISS_RETRY_MS = 30_000;

function useDismissForGood() {
  const queryClient = useQueryClient();
  return useCallback(
    function save(events: readonly CalendarEvent[]) {
      const saves = events.map((event) =>
        calendarApi.mark({ eventKey: event.key, end: event.end, kind: 'dismiss', on: true }),
      );
      void Promise.allSettled(saves).then((results) => {
        void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
        const failed = events.filter(
          (event, index) =>
            results[index]?.status === 'rejected' && Date.parse(event.end) > Date.now(),
        );
        if (failed.length > 0) setTimeout(() => save(failed), DISMISS_RETRY_MS);
      });
    },
    [queryClient],
  );
}

export function useIslandCalendar(
  minute: number,
  waiting: number,
  chats: readonly ConversationSummary[],
  onQuickChat: (text: string) => void,
  home: IslandHomePanel,
): IslandCalendar {
  const status = useCalendarStatus();
  const ready = status.data !== undefined && todayState(status.data) === 'ready';
  const nowQuery = useCalendarNow(ready);
  const live = ready ? (nowQuery.data ?? null) : null;
  const nudges = useNudgeClock(live, nowQuery.dataUpdatedAt);
  const dismissForGood = useDismissForGood();
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
  const liveChats = useMemo(() => chatStates(chats), [chats]);
  const { choosing, choose } = useChoosing(home);
  const names = useMemo(
    () => new Map((live?.calendars ?? []).map((choice) => [choice.key, choice.title])),
    [live],
  );
  const autoJoin = useMeetingAlert({
    live,
    settings: ready ? (status.data?.settings ?? null) : null,
    at,
    held: holdLabel !== null,
    marks: nudges.marks,
    setMarks: nudges.setMarks,
    names,
    note: home.note,
    onDismissed: dismissForGood,
  });
  const line = calendarLine({
    now: live,
    at,
    waiting,
    catchUp: held.catchUp,
    dismissed,
    marks: withJoined(nudges.marks, autoJoin.joined),
    chats: liveChats,
  });
  useIslandRequests(MEETING_REQUESTS, (pending) => {
    const event = live?.upcoming.find((candidate) => candidate.key === pending.target);
    if (!event) return null;
    if (pending.kind === 'join_meeting') {
      if (!event.link || !joinOpen(spanOf(event), Date.now())) return null;
      return () => autoJoin.joinEvent(event);
    }
    return () =>
      nudges.setMarks((current) =>
        snoozeNudgeFor(current, event.key, Date.parse(event.end), Date.now(), ALERT_SNOOZE_MS),
      );
  });
  const clashes = useMemo(
    () =>
      live ? new Map(live.clashes.map((clash) => [clash.eventKey, clash.titles])) : NO_CLASHES,
    [live],
  );
  return {
    connected: ready,
    line: line && lineUnderAlert(line, autoJoin.alert) ? null : line,
    hold: held.hold,
    at,
    upcoming: live
      ? stillOn(live.upcoming, at).filter((event) => !nudgeHidden(nudges.marks, event.key, at))
      : NO_MEETINGS,
    clashes,
    choosing: stillChoosing(choosing, nudges.marks, at),
    calendarName: (event) => names.get(event.calendarKey) ?? 'Calendar',
    hopKeys: hopKeys(live),
    countdown: autoJoin.countdown,
    onCancelJoin: autoJoin.cancelJoin,
    onJoinNow: autoJoin.joinNow,
    onJoined: autoJoin.markJoined,
    onOpenEvent: (eventKey) => openToday(eventKey),
    onChoose: choose,
    onSnooze: (event) =>
      nudges.setMarks((current) =>
        snoozeNudge(current, event.key, Date.parse(event.end), Date.now()),
      ),
    onSnoozeAlert: (event) =>
      nudges.setMarks((current) =>
        snoozeNudgeFor(current, event.key, Date.parse(event.end), Date.now(), ALERT_SNOOZE_MS),
      ),
    onDismissNudge: (event) => {
      nudges.setMarks((current) => dismissNudge(current, event.key, Date.parse(event.end)));
      dismissForGood([event]);
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
