import { lazy } from 'react';
import type { AppView } from './Rail.tsx';

const loadAnalytics = () =>
  import('../analytics/Analytics.tsx').then((module) => ({ default: module.Analytics }));
const loadTickets = () =>
  import('../tickets/Tickets.tsx').then((module) => ({ default: module.Tickets }));
const loadToday = () =>
  import('../calendar/Today.tsx').then((module) => ({ default: module.Today }));
const loadPhone = () =>
  import('../phone/PhonePage.tsx').then((module) => ({ default: module.PhonePage }));

const loadBrowser = () =>
  import('../browser-view/BrowserView.tsx').then((module) => ({ default: module.BrowserView }));

const loadOutpost = () =>
  import('../outposts/OutpostView.tsx').then((module) => ({ default: module.OutpostView }));

export const Analytics = lazy(loadAnalytics);
export const Tickets = lazy(loadTickets);
export const Phone = lazy(loadPhone);
export const Today = lazy(loadToday);
export const OutpostView = lazy(loadOutpost);
export const BrowserView = lazy(loadBrowser);

const VIEW_LOADERS: Partial<Record<AppView, () => Promise<unknown>>> = {
  analytics: loadAnalytics,
  tickets: loadTickets,
  phone: loadPhone,
  today: loadToday,
  browser: loadBrowser,
};

export function preloadView(view: AppView): void {
  void VIEW_LOADERS[view]?.().catch(() => undefined);
}
