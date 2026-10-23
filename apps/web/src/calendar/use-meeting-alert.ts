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
import { alertNotice, joinState } from './alert/alert-model.ts';
import { useEventClock } from './event-clock.ts';
import {
  AUTO_JOIN_COUNTDOWN_MS,
  autoJoinPlan,
  meetingAlert,
  type AutoJoinPlan,
  type Presence,
} from './meeting-alert.ts';
import { dismissNudge, snoozeNudgeFor, withJoined, type NudgeMarks } from './nudge-marks.ts';
import { openJoin } from './today-model.ts';

export const ALERT_SNOOZE_MS = 60_000;
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
  onDismissed: (events: readonly CalendarEvent[]) => void;
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
  const [cancelled, setCancelled] = useState<ReadonlySet<string>>(new Set());
  const [countdown, setCountdown] = useState<MeetingCountdown | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const canShow = sparkDesktop()?.meetingAlert !== undefined;
  const alert =
    settings && canShow
      ? meetingAlert({ now: live, settings, at, held, marks: withJoined(marks, joined) })
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
  const plan = useRef({ events, held, marks, joined, cancelled });
  useEffect(() => {
    plan.current = { events, held, marks, joined, cancelled };
  });
  const planNow = async (at: number): Promise<AutoJoinPlan> => {
    const presence = await (sparkDesktop()?.meetingAlert?.presence() ?? Promise.resolve(HERE));
    const current = plan.current;
    return autoJoinPlan({
      events: current.events ?? [],
      autoJoin: true,
      at,
      held: current.held,
      marks: current.marks,
      presence: parsePresence(presence),
      joined: new Set([...current.joined, ...current.cancelled]),
    });
  };
  const planNowRef = useRef(planNow);
  useEffect(() => {
    planNowRef.current = planNow;
  });

  useEffect(() => {
    if (!settings?.autoJoin || !events || countdown) return;
    let active = true;
    void planNowRef.current(at).then((next) => {
      if (!active || !('join' in next)) return;
      setCountdown({ eventKey: next.join.key, deadline: Date.now() + AUTO_JOIN_COUNTDOWN_MS });
    });
    return () => {
      active = false;
    };
  }, [settings?.autoJoin, events, at, held, marks, joined, cancelled, countdown]);

  useEffect(() => {
    if (!countdown) return;
    let active = true;
    const timer = setTimeout(
      () => {
        void planNowRef.current(Date.now()).then((next) => {
          if (!active) return;
          if ('join' in next && next.join.key === countdown.eventKey) {
            joinRef.current(next.join, true);
          } else {
            setCountdown(null);
          }
        });
      },
      Math.max(0, countdown.deadline - Date.now()),
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [countdown]);

  const cancelJoin = () => {
    if (countdown) setCancelled((current) => new Set(current).add(countdown.eventKey));
    setCountdown(null);
  };
  const markJoined = (eventKey: string) => setJoined((current) => new Set(current).add(eventKey));
  const joinNow = () => {
    const target = events?.find((event) => event.key === countdown?.eventKey);
    if (target) join(target, true);
  };

  const alertRef = useRef(alert);
  useEffect(() => {
    alertRef.current = alert;
  });

  const joinFromNotice = (eventKey: string) => {
    const target = alertRef.current?.events.find((event) => event.key === eventKey);
    if (target && joinState(target, Date.now()) === 'open') join(target, false);
  };

  const handlers = useRef({ cancelJoin, joinNow, joinFromNotice });
  useEffect(() => {
    handlers.current = { cancelJoin, joinNow, joinFromNotice };
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
        notice: alertNotice(alert.events),
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
      const shown = alertRef.current;
      const inAlert = shown && shown.key === action.key ? shown.events : [];
      if (action.kind === 'cancel-join') handlers.current.cancelJoin();
      if (action.kind === 'join-now') handlers.current.joinNow();
      if (action.kind === 'join' && action.eventKey && shown?.key === action.key) {
        handlers.current.joinFromNotice(action.eventKey);
      }
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
        latest.current.onDismissed(inAlert);
      }
    });
  }, [setMarks]);

  const joinEvent = (event: CalendarEvent) => join(event, false);
  return { alert, countdown, joined, cancelJoin, joinNow, markJoined, joinEvent };
}
