// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GracePeriodBar } from './GracePeriodBar.tsx';

let onElapse: ReturnType<typeof vi.fn<() => void>>;
let onUndo: ReturnType<typeof vi.fn<() => void>>;

function Bar({ shown }: { shown: boolean }) {
  return shown ? (
    <GracePeriodBar
      text="Resetting Spark…"
      announcement="Spark resets in 10 seconds."
      seconds={10}
      onElapse={onElapse}
      onUndo={onUndo}
    />
  ) : null;
}

beforeEach(() => {
  vi.useFakeTimers();
  onElapse = vi.fn<() => void>();
  onUndo = vi.fn<() => void>();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('GracePeriodBar', () => {
  it('counts down and fires exactly once when the time runs out', () => {
    render(<Bar shown />);
    expect(screen.getByText('10s')).toBeTruthy();
    advance(3000);
    expect(screen.getByText('7s')).toBeTruthy();
    advance(6999);
    expect(onElapse).not.toHaveBeenCalled();
    advance(1);
    advance(20_000);
    expect(onElapse).toHaveBeenCalledTimes(1);
  });

  it('moves focus to Undo only after the held key is let go', () => {
    render(<Bar shown />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    advance(100);
    expect(document.activeElement).not.toBe(undo);
    fireEvent.keyUp(window, { key: ' ' });
    advance(0);
    expect(document.activeElement).toBe(undo);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('calls undo from the button and from Escape', () => {
    render(<Bar shown />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it('never fires once it is taken away before the time runs out', () => {
    const view = render(<Bar shown />);
    advance(9000);
    view.rerender(<Bar shown={false} />);
    advance(5000);
    expect(onElapse).not.toHaveBeenCalled();
  });
});
