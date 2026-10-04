import { lazy } from 'react';
import { preloadTerminal } from '../terminal/terminal-connection.ts';
import { preloadDayCalendar } from '../ui/DayCalendar.tsx';
import { oneAtATimeWhenIdle } from '../ui/when-idle.ts';
import type { AppView } from './Rail.tsx';

const loadAnalytics = () =>
  import('../analytics/Analytics.tsx').then((module) => ({ default: module.Analytics }));
const loadTickets = () =>
  import('../tickets/Tickets.tsx').then((module) => ({ default: module.Tickets }));

export const Analytics = lazy(loadAnalytics);
export const Tickets = lazy(loadTickets);

const VIEW_LOADERS: Partial<Record<AppView, () => Promise<unknown>>> = {
  analytics: loadAnalytics,
  tickets: loadTickets,
};

export function preloadView(view: AppView): void {
  void VIEW_LOADERS[view]?.().catch(() => undefined);
}

const PRELOAD_AFTER_MS = 3_000;

export function preloadLazyUiWhenIdle(): () => void {
  return oneAtATimeWhenIdle(
    [loadAnalytics, loadTickets, preloadTerminal, preloadDayCalendar],
    PRELOAD_AFTER_MS,
  );
}
