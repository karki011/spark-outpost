import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TicketAssigneeFilter, TicketSearchQuery } from '@spark-outpost/contracts';
import { useDebouncedValue } from '../ui/use-debounced-value.ts';
import type { TicketFilters } from './ticket-model.ts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

const SEARCH_DELAY_MS = 250;

export function useTicketSearch(filters: TicketFilters, enabled: boolean) {
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState<TicketAssigneeFilter>('anyone');
  const typed = useDebouncedValue(text.trim(), SEARCH_DELAY_MS);
  const active = text.trim().length > 0;
  const query = useMemo<TicketSearchQuery>(
    () => ({
      q: typed,
      assignee,
      ...(filters.source === 'all' ? {} : { source: filters.source }),
      ...(filters.project ? { project: filters.project } : {}),
    }),
    [typed, assignee, filters.source, filters.project],
  );
  const results = useQuery({
    queryKey: ticketKeys.search(query),
    queryFn: () => ticketsApi.search(query),
    enabled: enabled && active && typed.length > 0,
    placeholderData: keepPreviousData,
  });
  const current = typed === text.trim() && !results.isPlaceholderData;
  return {
    text,
    setText,
    assignee,
    setAssignee,
    active,
    query: typed,
    results: current ? results.data : undefined,
    loading: !current || results.isPending,
    clear: () => {
      setText('');
      setAssignee('anyone');
    },
  };
}
