import type { AppView } from './Rail.tsx';

const VIEW_KEY = 'spark-outpost.view';
const VIEWS: readonly AppView[] = [
  'home',
  'chats',
  'today',
  'analytics',
  'tickets',
  'map',
  'docs',
  'phone',
];

function isAppView(value: string | null): value is AppView {
  return VIEWS.some((view) => view === value);
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
