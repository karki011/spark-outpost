import './address-suggestions.css';
import { useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { BrowserHistoryEntry, BrowserProfile } from '@spark-outpost/contracts';
import { browserHistoryApi, browserHistoryKey } from '../api/browser-history.ts';
import { useDebouncedValue } from '../ui/use-debounced-value.ts';
import { recheckNativePlacement } from './use-view-placement.ts';

const HISTORY_DELAY_MS = 120;

export function useAddressSuggestions(
  profile: BrowserProfile | null,
  typed: string | null,
): readonly BrowserHistoryEntry[] {
  const text = (typed ?? '').trim();
  const searched = useDebouncedValue(text, HISTORY_DELAY_MS);
  const asking = profile !== null && searched !== '';
  const found = useQuery({
    queryKey: [...browserHistoryKey, profile, searched],
    queryFn: ({ signal }) => browserHistoryApi.search(profile ?? 'work', searched, signal),
    enabled: asking,
    placeholderData: keepPreviousData,
  });
  return asking && text !== '' ? (found.data ?? []) : [];
}

export function stepSuggestion(active: number, count: number, key: string): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown') return active + 1 >= count ? -1 : active + 1;
  if (key === 'ArrowUp') return active < 0 ? count - 1 : active - 1;
  return null;
}

interface AddressSuggestionsProps {
  id: string;
  entries: readonly BrowserHistoryEntry[];
  active: number;
  onActive(index: number): void;
  onPick(url: string): void;
}

export function AddressSuggestions(props: AddressSuggestionsProps) {
  const { id, entries, active, onActive, onPick } = props;
  useEffect(() => {
    recheckNativePlacement();
    return recheckNativePlacement;
  }, [entries.length]);

  return (
    <ul className="bp-suggest" id={id} role="listbox" aria-label="Pages you visited">
      {entries.map((entry, index) => (
        <li
          key={entry.url}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          className={index === active ? 'bp-suggest-row act' : 'bp-suggest-row'}
          onPointerDown={(event) => event.preventDefault()}
          onPointerMove={() => onActive(index)}
          onClick={() => onPick(entry.url)}
        >
          <span className="bp-suggest-title">{entry.title || entry.url}</span>
          {entry.title && <span className="bp-suggest-url">{entry.url}</span>}
        </li>
      ))}
    </ul>
  );
}
