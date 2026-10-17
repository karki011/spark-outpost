import { useEffect, useRef, useState } from 'react';
import type { PromptCacheLast } from '@spark-outpost/contracts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { cacheView, nextCacheChange, type CacheState } from './cache-view.ts';
import './usage.css';

const EXPIRED = 'Prompt cache expired';

function useCacheClock(last: PromptCacheLast): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const next = nextCacheChange(last, now);
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [last, now]);
  return now;
}

function CacheClock({
  last,
  onChange,
}: {
  last: PromptCacheLast;
  onChange: (at: string, from: CacheState, to: CacheState) => void;
}) {
  const view = cacheView(last, useCacheClock(last));
  const shown = useRef(view.state);
  const tip = useTooltip(view.tip, { side: 'top' });
  useEffect(() => {
    if (shown.current !== view.state) onChange(last.at, shown.current, view.state);
    shown.current = view.state;
  }, [last.at, view.state, onChange]);
  return (
    <>
      <span
        className={`cache-timer cache-${view.state}`}
        tabIndex={0}
        data-cache-state={view.state}
        {...tip.triggerProps}
      >
        {view.text}
      </span>
      {tip.tooltip}
    </>
  );
}

export function CacheTimer({ last, idle }: { last: PromptCacheLast | null; idle: boolean }) {
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const [onChange] = useState(() => (at: string, from: CacheState, to: CacheState) => {
    if (from === 'warm' && to === 'cold') setExpiredAt(at);
  });
  if (!last) return null;
  const announcement = expiredAt === last.at ? EXPIRED : '';
  return (
    <>
      {idle && <CacheClock key={last.at} last={last} onChange={onChange} />}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
