import './calendar-parts.css';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshIcon, SpinnerIcon } from '../ui/icons.tsx';
import { calendarApi, calendarKeys } from './calendar-api.ts';

const JUST_NOW_MS = 60_000;

export function RefreshCalendar() {
  const queryClient = useQueryClient();
  const [fresh, setFresh] = useState(false);
  const refresh = useMutation({
    mutationFn: calendarApi.refresh,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: calendarKeys.all });
      setFresh(true);
    },
  });
  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(false), JUST_NOW_MS);
    return () => clearTimeout(timer);
  }, [fresh]);
  const busy = refresh.isPending;
  return (
    <div className="cal-refresh">
      <button
        type="button"
        className="btn line sm"
        aria-busy={busy}
        aria-disabled={busy}
        onClick={() => {
          if (!busy) refresh.mutate();
        }}
      >
        {busy ? <SpinnerIcon /> : <RefreshIcon />}
        {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
      <span className="cal-refresh-note" role="status">
        {refresh.isError ? "Couldn't refresh" : fresh && !busy ? 'Updated just now' : ''}
      </span>
    </div>
  );
}
