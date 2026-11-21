import { lazy } from 'react';
import type { AppView } from './Rail.tsx';

const loadAnalytics = () =>
  import('../analytics/Analytics.tsx').then((module) => ({ default: module.Analytics }));
const loadTickets = () =>
  import('../tickets/Tickets.tsx').then((module) => ({ default: module.Tickets }));
const loadGithub = () =>
  import('../github/GithubPage.tsx').then((module) => ({ default: module.GithubPage }));
const loadToday = () =>
  import('../calendar/Today.tsx').then((module) => ({ default: module.Today }));
const loadPhone = () =>
  import('../phone/PhonePage.tsx').then((module) => ({ default: module.PhonePage }));

const loadBrowser = () =>
  import('../browser-view/BrowserView.tsx').then((module) => ({ default: module.BrowserView }));

const loadSparks = () =>
  import('../sparks-page/SparksPage.tsx').then((module) => ({ default: module.SparksPage }));

export const Analytics = lazy(loadAnalytics);
export const Tickets = lazy(loadTickets);
export const Phone = lazy(loadPhone);
export const Today = lazy(loadToday);
export const GithubPage = lazy(loadGithub);
export const BrowserView = lazy(loadBrowser);
export const SparksPage = lazy(loadSparks);
export const MapPage = lazy(() =>
  import('../map/MapPage.tsx').then((module) => ({ default: module.MapPage })),
);
export const DocsPage = lazy(() =>
  import('../docs/DocsPage.tsx').then((module) => ({ default: module.DocsPage })),
);

export function PageWait({ label }: { label: string }) {
  return <main className="page" aria-label={label} aria-busy="true" />;
}

const VIEW_LOADERS: Partial<Record<AppView, () => Promise<unknown>>> = {
  analytics: loadAnalytics,
  tickets: loadTickets,
  phone: loadPhone,
  today: loadToday,
  github: loadGithub,
  browser: loadBrowser,
  sparks: loadSparks,
};

export function preloadView(view: AppView): void {
  void VIEW_LOADERS[view]?.().catch(() => undefined);
}

const loadSettings = () =>
  import('../settings/SettingsDialog.tsx').then((module) => ({
    default: module.SettingsDialog,
  }));

export const SettingsDialog = lazy(loadSettings);

export function preloadSettings(): void {
  void loadSettings().catch(() => undefined);
}

export const Onboarding = lazy(() =>
  import('../onboarding/Onboarding.tsx').then((module) => ({ default: module.Onboarding })),
);
