import { useEffect, useMemo, useRef, useState } from 'react';
import {
  meetingAlertActionSchema,
  spanOf,
  type CalendarEvent,
  type CalendarNow,
  type CalendarSettings,
  type MeetingCountdown,
} from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useEventClock } from './event-clock.ts';
import {
  AUTO_JOIN_COUNTDOWN_MS,
  autoJoinPlan,
  meetingAlert,
  type Presence,
} from './meeting-alert.ts';
import { dismissNudge, snoozeNudgeFor, type NudgeMarks } from './nudge-marks.ts';
import { openJoin } from './today-model.ts';

const ALERT_SNOOZE_MS = 60_000;
const HERE: Presence = { idleSeconds: 0, locked: false, asleep: false };

interface MeetingAlertOptions {
  live: CalendarNow | null;
  settings: CalendarSettings | null;
  at: number;
  held: boolean;
  marks: NudgeMarks;
  setMarks: (update: (marks: NudgeMarks) => NudgeMarks) => void;
  names: ReadonlyMap<string, string>;
  note: (text: string) => void;
}

function alertTimes(live: CalendarNow | null, settings: CalendarSettings | null): number[] {
  if (!live || !settings) return [];
  const lead = settings.alertLead * 60_000;
  return live.upcoming.flatMap((event) => {
    const { start } = spanOf(event);
    return [start - lead, start];
  });
}

function parsePresence(value: unknown): Presence {
  if (!value || typeof value !== 'object') return HERE;
  const { idleSeconds, locked, asleep } = value as Record<string, unknown>;
  return {
    idleSeconds: typeof idleSeconds === 'number' ? idleSeconds : 0,
    locked: locked === true,
    asleep: asleep === true,
  };
}

export function useMeetingAlert(options: MeetingAlertOptions) {
  const { live, settings, held, marks, setMarks, names } = options;
  const times = useMemo(() => alertTimes(live, settings), [live, settings]);
  const at = Math.max(options.at, useEventClock(times));
  const [joined, setJoined] = useState<ReadonlySet<string>>(new Set());
  const [countdown, setCountdown] = useState<MeetingCountdown | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const canShow = sparkDesktop()?.meetingAlert !== undefined;
  const alert = settings && canShow
    ? meetingAlert({ now: live, settings, at, held, marks: marksWithout(marks, joined) })
    : null;

  const join = (event: CalendarEvent, automatic: boolean) => {
    if (!event.link) return;
    openJoin(event.link.url);
    setJoined((current) => new Set(current).add(event.key));
    setCountdown(null);
    if (!automatic) return;
    sparkDesktop()?.meetingAlert?.autoJoined();
    latest.current.note(`Joined ${event.title} automatically`);
  };
  const joinRef = useRef(join);
  useEffect(() => {
    joinRef.current = join;
  });

  const events = live?.upcoming;
  useEffect(() => {
    if (!settings?.autoJoin || !events || countdown) return;
    let active = true;
    const presence = sparkDesktop()?.meetingAlert?.presence() ?? Promise.resolve(HERE);
    void presence.then((value) => {
      if (!active) return;
      const plan = autoJoinPlan({
        events,
        autoJoin: true,
        at,
        held,
        marks,
        presence: parsePresence(value),
        joined,
      });
      if ('join' in plan) {
        setCountdown({ eventKey: plan.join.key, deadline: Date.now() + AUTO_JOIN_COUNTDOWN_MS });
      }
    });
    return () => {
      active = false;
    };
  }, [settings?.autoJoin, events, at, held, marks, joined, countdown]);

  useEffect(() => {
    if (!countdown) return;
    const timer = setTimeout(
      () => {
        const target = events?.find((event) => event.key === countdown.eventKey);
        if (target) joinRef.current(target, true);
        else setCountdown(null);
      },
      Math.max(0, countdown.deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [countdown, events]);

  const cancelJoin = () => {
    if (countdown) setJoined((current) => new Set(current).add(countdown.eventKey));
    setCountdown(null);
  };
  const joinNow = () => {
    const target = events?.find((event) => event.key === countdown?.eventKey);
    if (target) join(target, true);
  };

  const handlers = useRef({ cancelJoin, joinNow });
  useEffect(() => {
    handlers.current = { cancelJoin, joinNow };
  });

  const payload = alert
    ? {
        key: alert.key,
        events: alert.events,
        calendars: Object.fromEntries(
          alert.events.map((event) => [
            event.calendarKey,
            names.get(event.calendarKey) ?? 'Calendar',
          ]),
        ),
        countdown,
      }
    : null;
  const payloadKey = JSON.stringify(payload);
  const payloadRef = useRef(payload);
  useEffect(() => {
    payloadRef.current = payload;
  });
  useEffect(() => {
    const bridge = sparkDesktop()?.meetingAlert;
    if (!bridge) return;
    const current = payloadRef.current;
    if (current) bridge.show(current);
    else bridge.hide();
  }, [payloadKey]);

  useEffect(() => {
    const bridge = sparkDesktop()?.meetingAlert;
    if (!bridge) return;
    return bridge.onAction((value) => {
      const parsed = meetingAlertActionSchema.safeParse(value);
      if (!parsed.success) return;
      const action = parsed.data;
      const shownEvents = latest.current.live?.upcoming ?? [];
      const inAlert = shownEvents.filter((event) => action.key.split('|').includes(event.key));
      if (action.kind === 'cancel-join') handlers.current.cancelJoin();
      if (action.kind === 'join-now') handlers.current.joinNow();
      if (action.kind === 'joined' && action.eventKey) {
        setJoined((current) => new Set(current).add(action.eventKey!));
      }
      if (action.kind === 'snooze') {
        setMarks((current) =>
          inAlert.reduce(
            (next, event) =>
              snoozeNudgeFor(next, event.key, Date.parse(event.end), Date.now(), ALERT_SNOOZE_MS),
            current,
          ),
        );
      }
      if (action.kind === 'dismiss') {
        setMarks((current) =>
          inAlert.reduce(
            (next, event) => dismissNudge(next, event.key, Date.parse(event.end)),
            current,
          ),
        );
      }
    });
  }, [setMarks]);

  return { alert, countdown, cancelJoin, joinNow };
}

function marksWithout(marks: NudgeMarks, joined: ReadonlySet<string>): NudgeMarks {
  if (joined.size === 0) return marks;
  const next = new Map(marks);
  for (const key of joined) next.set(key, { end: Infinity, dismissed: true, snoozedUntil: null });
  return next;
}
