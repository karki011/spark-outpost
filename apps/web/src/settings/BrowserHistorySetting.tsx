import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BrowserHistoryRange, BrowserProfile } from '@spark-outpost/contracts';
import { browserHistoryApi, browserHistoryKey } from '../api/browser-history.ts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { countLabel } from '../ui/count-label.ts';

export const CLEAR_HISTORY_LABEL = 'Clear browser history';

const RANGES: { id: BrowserHistoryRange; label: string }[] = [
  { id: 'hour', label: 'Last hour' },
  { id: 'day', label: 'Last 24 hours' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'all', label: 'All history' },
];

const PROFILES: { id: 'both' | BrowserProfile; label: string }[] = [
  { id: 'both', label: 'Personal and Work' },
  { id: 'personal', label: 'Personal' },
  { id: 'work', label: 'Work' },
];

function rangeOf(id: string): BrowserHistoryRange {
  return RANGES.find((range) => range.id === id)?.id ?? 'hour';
}

function profileOf(id: string): BrowserProfile | null {
  return id === 'personal' || id === 'work' ? id : null;
}

function clearSavedZooms(profile: 'both' | BrowserProfile): void {
  const profiles: BrowserProfile[] = profile === 'both' ? ['personal', 'work'] : [profile];
  for (const each of profiles) void desktopBrowserView()?.clearZooms(each);
}

export function BrowserHistorySetting() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<BrowserHistoryRange>('hour');
  const [profile, setProfile] = useState<'both' | BrowserProfile>('both');
  const clear = useMutation({
    mutationFn: () => browserHistoryApi.clear({ profile: profileOf(profile), range }),
    onSuccess: () => {
      if (range === 'all') clearSavedZooms(profile);
      return queryClient.invalidateQueries({ queryKey: browserHistoryKey });
    },
  });
  return (
    <div className="set-sites" role="group" aria-label={CLEAR_HISTORY_LABEL}>
      <p className="set-hint">
        The Browser view keeps the pages you visit in each profile on this Mac, for its command bar.
        No agent, Ask Spark or paired device can read it.
      </p>
      <div className="set-history-row">
        <ChoicePicker
          label="Time range"
          choices={RANGES}
          value={range}
          onChange={(id) => setRange(rangeOf(id))}
        />
        <ChoicePicker
          label="Profile"
          choices={PROFILES}
          value={profile}
          onChange={(id) => setProfile(profileOf(id) ?? 'both')}
        />
        <button
          type="button"
          className="btn line sm"
          disabled={clear.isPending}
          onClick={() => clear.mutate()}
        >
          {CLEAR_HISTORY_LABEL}
        </button>
      </div>
      <p className="set-hint" role="status">
        {clear.isSuccess ? `Cleared ${countLabel(clear.data, 'page')}.` : ''}
      </p>
      {clear.isError && (
        <p className="set-hint" role="alert">
          {clear.error.message}
        </p>
      )}
    </div>
  );
}
