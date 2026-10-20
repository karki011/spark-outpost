import { useEffect, useState } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

const NONE: ReadonlySet<string> = new Set();

function parseViewed(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return NONE;
  return new Set(value.filter((id): id is string => typeof id === 'string'));
}

export function useViewedChats(): ReadonlySet<string> {
  const viewing = sparkDesktop()?.viewing;
  const [viewed, setViewed] = useState<ReadonlySet<string>>(NONE);
  useEffect(() => {
    if (!viewing) return;
    let live = true;
    void viewing.get().then((value) => {
      if (live) setViewed(parseViewed(value));
    });
    const off = viewing.onChange((value) => setViewed(parseViewed(value)));
    return () => {
      live = false;
      off();
    };
  }, [viewing]);
  return viewed;
}

export function useReportViewedChat(chatId: string | null): void {
  const viewing = sparkDesktop()?.viewing;
  useEffect(() => {
    viewing?.report(chatId);
  }, [viewing, chatId]);
  useEffect(() => () => viewing?.report(null), [viewing]);
}
