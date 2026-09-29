// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResetState } from './reset-store.ts';
import {
  graceBlobMood,
  moodForProgress,
  nextResetBlobMood,
  SETTLE_MS,
  type ResetBlobEvent,
  type ResetBlobMood,
} from './reset-blob-mood.ts';
import { useResetBlobMood } from './use-reset-blob-mood.ts';

const play = (events: ResetBlobEvent[], from: ResetBlobMood = 'calm') =>
  events.reduce(nextResetBlobMood, from);

describe('moodForProgress', () => {
  it('escalates from worried to panic to a full scream', () => {
    expect([0, 0.29, 0.3, 0.69, 0.7, 1].map(moodForProgress)).toEqual([
      'worried',
      'worried',
      'panic',
      'panic',
      'scream',
      'scream',
    ]);
  });
});

describe('nextResetBlobMood', () => {
  it('sighs with relief when the hold is released early, then settles', () => {
    const released = play([
      { phase: 'holding', progress: 0 },
      { phase: 'holding', progress: 0.8 },
      { phase: 'released', progress: 0.8 },
    ]);
    expect(released).toBe('relieved');
    expect(nextResetBlobMood(released, { phase: 'settled' })).toBe('calm');
  });

  it('leaves for the grace bar when the hold completes and stays away after the key is let go', () => {
    expect(
      play([
        { phase: 'holding', progress: 0.9 },
        { phase: 'done', progress: 1 },
        { phase: 'idle', progress: 0 },
      ]),
    ).toBe('away');
  });

  it('cheers when the reset is undone', () => {
    expect(play([{ phase: 'undone' }], 'away')).toBe('happy');
  });
});

describe('graceBlobMood', () => {
  it('pleads during the countdown and waves in the last second', () => {
    expect([10, 2, 1, 0].map(graceBlobMood)).toEqual(['plead', 'plead', 'bye', 'bye']);
  });
});

describe('useResetBlobMood', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mount = () =>
    renderHook(({ phase }: { phase: ResetState['phase'] }) => useResetBlobMood(phase), {
      initialProps: { phase: 'idle' as ResetState['phase'] },
    });

  it('cheers after Undo and calms down again', () => {
    const { result, rerender } = mount();
    act(() => result.current[1]({ phase: 'done', progress: 1 }));
    rerender({ phase: 'counting' });
    expect(result.current[0]).toBe('away');
    rerender({ phase: 'idle' });
    expect(result.current[0]).toBe('happy');
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(result.current[0]).toBe('calm');
  });

  it('comes back calm, not cheering, when the reset fails', () => {
    const { result, rerender } = mount();
    act(() => result.current[1]({ phase: 'done', progress: 1 }));
    rerender({ phase: 'counting' });
    rerender({ phase: 'resetting' });
    expect(result.current[0]).toBe('away');
    rerender({ phase: 'failed' });
    expect(result.current[0]).toBe('calm');
    rerender({ phase: 'idle' });
    expect(result.current[0]).toBe('calm');
  });
});
