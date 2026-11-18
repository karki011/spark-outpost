import { browserViewAvailable } from '../browser-view/view-store.ts';
import { usePhone } from '../ui/breakpoints.ts';
import type { AppView } from './Rail.tsx';

const VIEW_KEY = 'spark-outpost.view';
const VIEWS: readonly AppView[] = [
  'home',
  'chats',
  'browser',
  'today',
  'analytics',
  'tickets',
  'github',
  'sparks',
  'map',
  'docs',
  'phone',
];

function isAppView(value: string | null): value is AppView {
  return VIEWS.some((view) => view === value);
}

const MAC_ONLY_VIEWS: readonly AppView[] = ['today', 'github', 'browser'];

interface ViewPlace {
  phone: boolean;
  remote: boolean;
  browser: boolean;
}

export function isHiddenView(view: AppView, place: ViewPlace): boolean {
  if (place.phone && (view === 'map' || view === 'browser')) return true;
  if (place.remote && MAC_ONLY_VIEWS.includes(view)) return true;
  return view === 'browser' && !place.browser;
}

export function useShownView(stored: AppView, remote: boolean): AppView {
  const phone = usePhone();
  const hidden = isHiddenView(stored, { phone, remote, browser: browserViewAvailable() });
  return hidden ? 'home' : stored;
}

export function readSavedView(): AppView {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return isAppView(saved) ? saved : 'home';
  } catch {
    return 'home';
  }
}

export function saveView(view: AppView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    return;
  }
}
