import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MEETING_LINES_PAGE, type MeetingLine } from '@spark-outpost/contracts';
import { meetingKeys } from './meeting-keys.ts';
import { meetingsApi } from './meetings-api.ts';

interface LinesCache {
  lines: MeetingLine[];
  hasEarlier: boolean;
}

function lastSeq(cache: LinesCache): number {
  return cache.lines.at(-1)?.seq ?? 0;
}

export function useMeetingLines(id: string, lineCount: number) {
  const client = useQueryClient();
  const key = meetingKeys.lines(id);
  const [tick, setTick] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const busy = useRef(false);

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<LinesCache> => {
      const page = await meetingsApi.linesTail(id);
      return { lines: page.lines, hasEarlier: (page.lines[0]?.seq ?? 1) > 1 };
    },
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
  const loaded = query.data !== undefined;
  const latest = query.data ? lastSeq(query.data) : 0;

  useEffect(() => {
    if (!loaded || lineCount <= latest || busy.current) return;
    busy.current = true;
    const catchUp = async () => {
      let more = true;
      while (more) {
        const current = client.getQueryData<LinesCache>(key);
        if (!current) return;
        const page = await meetingsApi.linesAfter(id, lastSeq(current), MEETING_LINES_PAGE);
        client.setQueryData<LinesCache>(key, (cache) => {
          if (!cache) return cache;
          const seen = lastSeq(cache);
          return { ...cache, lines: [...cache.lines, ...page.lines.filter((l) => l.seq > seen)] };
        });
        more = page.more && page.lines.length > 0;
      }
    };
    void catchUp()
      .catch(() => undefined)
      .finally(() => {
        busy.current = false;
        setTick((value) => value + 1);
      });
  }, [client, id, key, lineCount, loaded, latest, tick]);

  const loadEarlier = useCallback(async () => {
    const current = client.getQueryData<LinesCache>(key);
    const first = current?.lines[0]?.seq;
    if (!current || !current.hasEarlier || first === undefined || loadingEarlier) return;
    const after = Math.max(0, first - 1 - MEETING_LINES_PAGE);
    setLoadingEarlier(true);
    try {
      const page = await meetingsApi.linesAfter(id, after, first - 1 - after);
      client.setQueryData<LinesCache>(key, (cache) => {
        if (!cache) return cache;
        const top = cache.lines[0]?.seq ?? Infinity;
        return {
          lines: [...page.lines.filter((line) => line.seq < top), ...cache.lines],
          hasEarlier: after > 0,
        };
      });
    } finally {
      setLoadingEarlier(false);
    }
  }, [client, id, key, loadingEarlier]);

  return {
    lines: query.data?.lines ?? [],
    hasEarlier: query.data?.hasEarlier ?? false,
    query,
    loadingEarlier,
    loadEarlier,
  };
}
