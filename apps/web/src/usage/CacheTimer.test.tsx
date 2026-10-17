// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptCacheLast } from '@spark-outpost/contracts';
import { CacheTimer } from './CacheTimer.tsx';

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT + 2 * MINUTE + 30_000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const status = () => screen.getByRole('status');

describe('CacheTimer', () => {
  it('shows nothing while the session is busy, but keeps its live region', () => {
    render(<CacheTimer last={last} idle={false} />);
    expect(screen.queryByText(/Cache/)).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('counts down once a minute and announces only the change to cold', () => {
    render(<CacheTimer last={last} idle />);
    expect(screen.getByText('Cache warm · 3 min left')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(MINUTE));
    expect(screen.getByText('Cache warm · 2 min left')).toBeTruthy();
    expect(status().textContent).toBe('');
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.getByText('Cache warm · 1 min left')).toBeTruthy();
    expect(status().textContent).toBe('');
    act(() => void vi.advanceTimersByTime(MINUTE));
    expect(screen.getByText('Cache cold · next message re-writes ~182K tokens (~$2.28)')).toBeTruthy();
    expect(status().textContent).toBe('Prompt cache expired');
  });

  it('does not tick every second', () => {
    render(<CacheTimer last={last} idle />);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('can be reached with the keyboard for its explanation', () => {
    render(<CacheTimer last={last} idle />);
    expect(screen.getByText(/Cache warm/).getAttribute('tabindex')).toBe('0');
  });
});
