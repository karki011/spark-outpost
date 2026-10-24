import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PromptCacheLast } from '@spark-outpost/contracts';
import { cacheBadge, type CacheBadge, type CacheBadgeKind } from './cache-badge.ts';
import { CACHE_EXPIRED, nextCacheChange } from './cache-view.ts';
import './ring-cache.css';

const CENTER = 7;
const PIE = 3.6;

interface RingCacheState {
  badge: CacheBadge | null;
  expired: boolean;
}

const NONE: RingCacheState = { badge: null, expired: false };

function justExpired(before: CacheBadgeKind, after: CacheBadgeKind): boolean {
  return (before === 'warm' || before === 'expiring') && after === 'expired';
}

function CacheClockSource({
  last,
  onChange,
}: {
  last: PromptCacheLast;
  onChange: (state: RingCacheState) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const shown = useRef<CacheBadgeKind | null>(null);
  const expired = useRef(false);
  useEffect(() => {
    const next = nextCacheChange(last, now);
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [last, now]);
  useEffect(() => {
    const badge = cacheBadge(last, now);
    if (shown.current && justExpired(shown.current, badge.kind)) expired.current = true;
    shown.current = badge.kind;
    onChange({ badge, expired: expired.current });
  }, [last, now, onChange]);
  useEffect(() => () => onChange(NONE), [onChange]);
  return null;
}

export function useRingCache(last: PromptCacheLast | null): {
  badge: CacheBadge | null;
  announcement: string;
  clock: ReactNode;
} {
  const [state, setState] = useState<RingCacheState>(NONE);
  const clock = last ? <CacheClockSource key={last.at} last={last} onChange={setState} /> : null;
  return { badge: state.badge, announcement: state.expired ? CACHE_EXPIRED : '', clock };
}

function piePath(left: number): string {
  const angle = left * 2 * Math.PI;
  const x = CENTER + PIE * Math.sin(angle);
  const y = CENTER - PIE * Math.cos(angle);
  const large = left > 0.5 ? 1 : 0;
  return `M${CENTER} ${CENTER}V${CENTER - PIE}A${PIE} ${PIE} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`;
}

function BadgeMark({ badge }: { badge: CacheBadge }) {
  if (badge.kind === 'expired') return <path className="cb-mark" d="M4.6 4.6 9.4 9.4" />;
  if (badge.kind === 'unknown') return <path className="cb-mark" d="M7 4.2V7l1.9 1.3" />;
  if (badge.left >= 1) return <circle className="cb-fill" cx={CENTER} cy={CENTER} r={PIE} />;
  return <path className="cb-fill" d={piePath(badge.left)} />;
}

export function CacheBadgeGlyph({ badge }: { badge: CacheBadge }) {
  return (
    <svg
      className={`cache-badge ${badge.kind}`}
      data-cache-badge={badge.kind}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle className="cb-halo" cx={CENTER} cy={CENTER} r={CENTER} />
      <circle className="cb-face" cx={CENTER} cy={CENTER} r="5.4" />
      <BadgeMark badge={badge} />
    </svg>
  );
}

export function CacheRow({ badge }: { badge: CacheBadge }) {
  return (
    <div className="ctx-cache">
      <div className="ctx-cache-h">
        <CacheBadgeGlyph badge={badge} />
        <span>Prompt cache</span>
        <b className={badge.kind}>{badge.status}</b>
      </div>
      <p>{badge.tip}</p>
    </div>
  );
}
