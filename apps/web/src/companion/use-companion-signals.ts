import { useEffect, useRef, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { finishedRunIds, runStatuses, type RunStatuses } from './companion-model.ts';

const CELEBRATE_MS = 1_600;
const ANNOUNCE_MS = 8_000;
const ANNOUNCE_SETTLE_MS = 1_000;

export function useCelebration(chats: readonly ConversationSummary[]): boolean {
  const [tracked, setTracked] = useState<{
    chats: readonly ConversationSummary[];
    statuses: RunStatuses;
    count: number;
  }>(() => ({ chats, statuses: runStatuses(chats), count: 0 }));
  const [settled, setSettled] = useState(0);

  if (tracked.chats !== chats) {
    const finished = finishedRunIds(tracked.statuses, chats).length > 0;
    setTracked({
      chats,
      statuses: runStatuses(chats),
      count: finished ? tracked.count + 1 : tracked.count,
    });
  }

  useEffect(() => {
    if (tracked.count === settled) return;
    const timer = setTimeout(() => setSettled(tracked.count), CELEBRATE_MS);
    return () => clearTimeout(timer);
  }, [tracked.count, settled]);

  return tracked.count !== settled;
}

export function useThrottledAnnouncement(text: string, active: boolean): string {
  const [spoken, setSpoken] = useState('');
  const baseline = useRef<string | null>(null);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!active) {
      baseline.current = null;
      return;
    }
    if (baseline.current === null) {
      baseline.current = text;
      return;
    }
    if (text === baseline.current) return;
    const wait = Math.max(ANNOUNCE_SETTLE_MS, lastAt.current + ANNOUNCE_MS - Date.now());
    const timer = setTimeout(() => {
      baseline.current = text;
      lastAt.current = Date.now();
      setSpoken(`Status: ${text}`);
    }, wait);
    return () => clearTimeout(timer);
  }, [text, active]);

  return active ? spoken : '';
}
