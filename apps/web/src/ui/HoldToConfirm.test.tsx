// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldToConfirm, type HoldChange } from './HoldToConfirm.tsx';

let onConfirm: ReturnType<typeof vi.fn<() => void>>;
let onHoldChange: ReturnType<typeof vi.fn<(change: HoldChange) => void>>;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  onConfirm = vi.fn<() => void>();
  onHoldChange = vi.fn<(change: HoldChange) => void>();
  render(
    <HoldToConfirm
      label="Hold to reset"
      hint="Press and hold."
      holdingHint="Keep holding."
      releasedHint="Released early. Nothing happened."
      holdMs={1500}
      onConfirm={onConfirm}
      onHoldChange={onHoldChange}
    />,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const button = () => screen.getByRole('button');
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('HoldToConfirm', () => {
  it('does nothing when the pointer lets go early', () => {
    fireEvent.pointerDown(button(), { button: 0, pointerId: 1 });
    advance(1400);
    expect(screen.getByText('Keep holding.')).toBeTruthy();
    fireEvent.pointerUp(button(), { button: 0, pointerId: 1 });
    advance(2000);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Released early. Nothing happened.')).toBeTruthy();
  });

  it('fires once after a full hold, however long the hold lasts', () => {
    fireEvent.pointerDown(button(), { button: 0, pointerId: 1 });
    advance(1500);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    advance(5000);
    fireEvent.pointerUp(button(), { button: 0, pointerId: 1 });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores a right click', () => {
    fireEvent.pointerDown(button(), { button: 2, pointerId: 1 });
    advance(2000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with a held Space key and ignores key repeats', () => {
    fireEvent.keyDown(button(), { key: ' ' });
    advance(800);
    fireEvent.keyDown(button(), { key: ' ', repeat: true });
    advance(700);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(button(), { key: ' ' });
  });

  it('cancels when Enter is released early or focus leaves', () => {
    fireEvent.keyDown(button(), { key: 'Enter' });
    advance(1000);
    fireEvent.keyUp(button(), { key: 'Enter' });
    fireEvent.keyDown(button(), { key: 'Enter' });
    advance(1000);
    fireEvent.blur(button());
    advance(2000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('reports hold progress, an early release and completion', () => {
    const lastChange = () => onHoldChange.mock.lastCall?.[0];
    fireEvent.pointerDown(button(), { button: 0, pointerId: 1 });
    expect(lastChange()).toEqual({ phase: 'holding', progress: 0 });
    advance(750);
    expect(lastChange()?.phase).toBe('holding');
    expect(lastChange()?.progress).toBeCloseTo(0.5, 1);
    fireEvent.pointerUp(button(), { button: 0, pointerId: 1 });
    expect(lastChange()?.phase).toBe('released');
    expect(lastChange()?.progress).toBeCloseTo(0.5, 1);
    const calls = onHoldChange.mock.calls.length;
    advance(1000);
    expect(onHoldChange.mock.calls.length).toBe(calls);

    fireEvent.pointerDown(button(), { button: 0, pointerId: 1 });
    advance(1500);
    expect(lastChange()).toEqual({ phase: 'done', progress: 1 });
    fireEvent.pointerUp(button(), { button: 0, pointerId: 1 });
    expect(lastChange()).toEqual({ phase: 'idle', progress: 0 });
  });
});
