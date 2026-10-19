// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoinButton } from './JoinButton.tsx';
import { at, event, link } from './test-fixtures.ts';
import { HOP_MS, useMeetingHop } from './use-meeting-hop.ts';

const tones: number[] = [];

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() {
    const frequency = { value: 0 };
    return {
      type: 'sine',
      frequency,
      connect: (node: unknown) => node,
      start: () => tones.push(frequency.value),
      stop: () => undefined,
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      connect: (next: unknown) => next,
    };
  }
}

interface Props {
  hopKey: string[];
  on: boolean;
  held: boolean;
}

function hop(first: Props) {
  return renderHook((props: Props) => useMeetingHop(props.hopKey, props.on, props.held), {
    initialProps: first,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  tones.length = 0;
});

describe('useMeetingHop', () => {
  it('hops once with a short tune for a new nudge, then rests', () => {
    const hook = hop({ hopKey: [], on: true, held: false });
    expect(hook.result.current).toBe(false);
    hook.rerender({ hopKey: ['before:standup'], on: true, held: false });
    expect(hook.result.current).toBe(true);
    expect(tones.length).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(HOP_MS));
    expect(hook.result.current).toBe(false);
    const played = tones.length;
    hook.rerender({ hopKey: ['before:standup'], on: true, held: false });
    expect(hook.result.current).toBe(false);
    expect(tones.length).toBe(played);
  });

  it('hops and plays once for a group, even when another member leads later', () => {
    const hook = hop({ hopKey: ['before:a', 'before:b', 'before:c'], on: true, held: false });
    expect(hook.result.current).toBe(true);
    const played = tones.length;
    act(() => vi.advanceTimersByTime(HOP_MS));
    hook.rerender({ hopKey: ['before:b', 'before:c'], on: true, held: false });
    expect(hook.result.current).toBe(false);
    expect(tones.length).toBe(played);
    hook.rerender({ hopKey: ['before:d'], on: true, held: false });
    expect(hook.result.current).toBe(true);
  });

  it('still hops but plays nothing when chimes are off or held', () => {
    const off = hop({ hopKey: ['before:a'], on: false, held: false });
    expect(off.result.current).toBe(true);
    const held = hop({ hopKey: ['before:b'], on: true, held: true });
    expect(held.result.current).toBe(true);
    expect(tones).toEqual([]);
  });
});

describe('JoinButton', () => {
  const standup = event('Standup', at(10), at(10, 30), { link: link('zoom') });

  it('shows the start time before Join opens, ten minutes ahead', () => {
    render(<JoinButton event={standup} now={at(9, 49)} />);
    const button = screen.getByRole('button', { name: /Standup at 10:00 AM, Join opens at 9:50 AM/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe('10:00 AM');
  });

  it('is one click to join from ten minutes before until the end', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(<JoinButton event={standup} now={at(9, 50)} />);
    const button = screen.getByRole('button', { name: 'Join Standup' });
    button.click();
    expect(open).toHaveBeenCalledWith('https://acme.zoom.us/j/1', '_blank', 'noopener,noreferrer');
  });

  it('says ended after the meeting and renders nothing without a link', () => {
    const { container } = render(
      <>
        <JoinButton event={standup} now={at(10, 30)} />
        <JoinButton event={{ ...standup, link: null }} now={at(10)} />
      </>,
    );
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(
      (screen.getByRole('button', { name: 'Standup has ended' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
