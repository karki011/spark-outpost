import type { Db } from '../persistence/db.ts';
import { SentKeys } from '../remote/push-plan.ts';
import type { CalendarHost } from './host-client.ts';
import { activeHold, meetingPushDue } from './planner.ts';
import { announceCalendar } from './routes.ts';
import { calendarState } from './service.ts';

export const CALENDAR_TICK_MS = 60_000;

export interface MeetingPushes {
  meeting(minutes: 5 | 10 | 15): void;
  release(): void;
}

export interface CalendarTickerDeps {
  db: Db;
  workspaceId: string;
  host: CalendarHost;
  push: MeetingPushes;
  now?: () => number;
  tickMs?: number;
}

export interface CalendarTicker {
  held(): boolean;
  tick(): Promise<void>;
  stop(): void;
}

export function startCalendarTicker(deps: CalendarTickerDeps): CalendarTicker {
  const now = deps.now ?? Date.now;
  const sent = new SentKeys();
  let holding = false;
  let running: Promise<void> | null = null;

  const setHolding = (next: boolean) => {
    const released = holding && !next;
    holding = next;
    if (released) deps.push.release();
  };

  const once = async () => {
    const state = await calendarState({ ...deps, now });
    const at = now();
    setHolding(activeHold(state.events, state.settings, at) !== null);
    if (!state.settings.phoneAlerts || holding) return;
    for (const event of meetingPushDue(state.events, state.settings, at)) {
      if (sent.claim(event.key)) deps.push.meeting(state.settings.beforeMinutes);
    }
  };

  const tick = () => {
    running ??= once()
      .catch((error: unknown) => {
        console.error('Calendar check failed', (error as Error).message);
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  deps.host.onChanged(() => {
    void announceCalendar(deps.db).catch(() => undefined);
    void tick();
  });
  const timer = setInterval(() => void tick(), deps.tickMs ?? CALENDAR_TICK_MS);
  timer.unref();

  return {
    held: () => holding,
    tick,
    stop: () => clearInterval(timer),
  };
}
