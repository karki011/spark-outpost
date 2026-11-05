import { useCallback, useState } from 'react';
import type { TicketView } from './ticket-model.ts';
import { DEFAULT_VIEW, parseView } from './ticket-views.ts';

const VIEW_KEY = 'spark-outpost.tickets.view';

function readView(): TicketView {
  try {
    return parseView(localStorage.getItem(VIEW_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

export function useTicketView() {
  const [view, setViewState] = useState<TicketView>(readView);
  const setView = useCallback((next: TicketView) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      return;
    }
  }, []);
  return [view, setView] as const;
}
