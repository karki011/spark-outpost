// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptCacheLast } from '@spark-outpost/contracts';
import { CacheBadgeGlyph, CacheRow, useRingCache } from './RingCache.tsx';

const AT = Date.parse('2026-10-17T12:00:00Z');
const MINUTE = 60_000;
const last: PromptCacheLast = {
  at: new Date(AT).toISOString(),
  contextTokens: 182_000,
  ttlSeconds: 300,
  rewriteUsd: 2.28,
  expired: null,
  estimateBy: 'spark',
};

function Ring({ cache }: { cache: PromptCacheLast | null }) {
  const { badge, announcement, clock } = useRingCache(cache);
  return (
    <>
      {clock}
      <span data-testid="label">{badge?.sentence ?? ''}</span>
      {badge && <CacheBadgeGlyph badge={badge} />}
      {badge && <CacheRow badge={badge} />}
      <span role="status">{announcement}</span>
    </>
  );
}

const glyph = () => document.querySelector('svg.cache-badge');
const label = () => screen.getByTestId('label').textContent;
const announced = () => screen.getByRole('status').textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT + 2 * MINUTE + 30_000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useRingCache', () => {
  it('steps the badge once a minute and announces only the change to expired', () => {
    render(<Ring cache={last} />);
    expect(label()).toBe('Prompt cache warm · 3 min left');
    expect(glyph()?.getAttribute('data-cache-badge')).toBe('warm');
    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(MINUTE));
    expect(label()).toBe('Prompt cache warm · 2 min left');
    act(() => void vi.advanceTimersByTime(MINUTE));
    expect(label()).toBe('Prompt cache expires in 1 min');
    expect(glyph()?.getAttribute('data-cache-badge')).toBe('expiring');
    expect(announced()).toBe('');
    act(() => void vi.advanceTimersByTime(MINUTE));
    expect(label()).toBe('Prompt cache expired, next message re-writes ~182K tokens (~$2.28)');
    expect(glyph()?.getAttribute('data-cache-badge')).toBe('expired');
    expect(announced()).toBe('Prompt cache expired');
  });

  it('does not announce a cache that was already expired when it appeared', () => {
    vi.setSystemTime(AT + 10 * MINUTE);
    render(<Ring cache={last} />);
    expect(glyph()?.getAttribute('data-cache-badge')).toBe('expired');
    expect(announced()).toBe('');
  });

  it('shows nothing while busy, and reads a fresh clock when idle again', () => {
    const { rerender } = render(<Ring cache={last} />);
    rerender(<Ring cache={null} />);
    expect(glyph()).toBeNull();
    expect(label()).toBe('');
    vi.setSystemTime(AT + 4 * MINUTE + 10_000);
    rerender(<Ring cache={{ ...last, at: new Date(AT + 4 * MINUTE).toISOString() }} />);
    expect(label()).toBe('Prompt cache warm · 5 min left');
    expect(announced()).toBe('');
  });

  it('puts the state in words in the popover row', () => {
    render(<Ring cache={last} />);
    expect(screen.getByText('Prompt cache')).toBeTruthy();
    expect(screen.getByText('Warm · 3 min left')).toBeTruthy();
    expect(screen.getByText(/5 minutes after the last request/)).toBeTruthy();
  });
});
