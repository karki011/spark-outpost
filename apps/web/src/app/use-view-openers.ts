import { useCallback } from 'react';
import { useBrowserViewOpener } from '../browser-view/view-store.ts';
import { useTodayOpener } from '../calendar/today-request.ts';
import { useSparksPageOpener } from '../sparks-page/sparks-route.ts';
import type { AppView } from './Rail.tsx';

export function useViewOpeners(show: (view: AppView) => void): void {
  useTodayOpener(useCallback(() => show('today'), [show]));
  useBrowserViewOpener(useCallback(() => show('browser'), [show]));
  useSparksPageOpener(useCallback(() => show('sparks'), [show]));
}
