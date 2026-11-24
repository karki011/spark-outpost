// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealAllTurns } from './reveal-turns.ts';
import { IDLE_BATCH, INITIAL_TURNS } from './turn-window.ts';
import { useTurnWindow } from './use-turn-window.ts';

const ids = Array.from({ length: 20 }, (_, index) => `run-${index}`);
let idle: (() => void)[] = [];

function Thread({ chatId, turns }: { chatId: string; turns: readonly string[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const turnWindow = useTurnWindow(chatId, turns, scroller);
  return (
    <div ref={scroller}>
      <button type="button" onClick={() => turnWindow.reveal(['run-0'])}>
        Oldest
      </button>
      {turns.map((id) => (
        <section
          key={id}
          data-turn={id}
          data-deferred={turnWindow.mounted.has(id) ? undefined : ''}
        >
          {turnWindow.mounted.has(id) ? id : null}
        </section>
      ))}
    </div>
  );
}

function shown(container: HTMLElement): string[] {
  return [...container.querySelectorAll('section:not([data-deferred])')].map(
    (section) => section.textContent ?? '',
  );
}

function runIdle(): void {
  const work = idle;
  idle = [];
  act(() => work.forEach((each) => each()));
}

beforeEach(() => {
  idle = [];
  vi.stubGlobal('requestIdleCallback', (work: () => void) => idle.push(work));
  vi.stubGlobal('cancelIdleCallback', (handle: number) => {
    idle[handle - 1] = () => undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useTurnWindow', () => {
  it('shows the newest turns first and keeps a section for every turn', () => {
    const { container } = render(<Thread chatId="a" turns={ids} />);
    expect(shown(container)).toEqual(ids.slice(-INITIAL_TURNS));
    expect(container.querySelectorAll('section')).toHaveLength(ids.length);
  });

  it('mounts older turns a few at a time while idle until none wait', () => {
    const { container } = render(<Thread chatId="a" turns={ids} />);
    runIdle();
    expect(shown(container)).toEqual(ids.slice(-INITIAL_TURNS - IDLE_BATCH));
    for (let round = 0; round < ids.length; round += 1) runIdle();
    expect(shown(container)).toEqual(ids);
    expect(idle).toEqual([]);
  });

  it('mounts every turn at once when something asks for a turn that is not there', () => {
    const { container } = render(<Thread chatId="a" turns={ids} />);
    act(() => revealAllTurns());
    expect(shown(container)).toEqual(ids);
  });

  it('mounts one named turn on request', () => {
    const { container, getByRole } = render(<Thread chatId="a" turns={ids} />);
    fireEvent.click(getByRole('button'));
    expect(shown(container)).toEqual(['run-0', ...ids.slice(-INITIAL_TURNS)]);
  });

  it('mounts a new turn at once and keeps the turns already shown', () => {
    const { container, rerender } = render(<Thread chatId="a" turns={ids} />);
    rerender(<Thread chatId="a" turns={[...ids, 'run-20']} />);
    expect(shown(container)).toEqual([...ids.slice(-INITIAL_TURNS), 'run-20']);
  });

  it('starts again from the newest turns of another chat', () => {
    const { container, rerender } = render(<Thread chatId="a" turns={ids} />);
    act(() => revealAllTurns());
    const other = ids.map((id) => `other-${id}`);
    rerender(<Thread chatId="b" turns={other} />);
    expect(shown(container)).toEqual(other.slice(-INITIAL_TURNS));
  });

  it('leaves a short chat alone', () => {
    const { container } = render(<Thread chatId="a" turns={ids.slice(0, INITIAL_TURNS)} />);
    expect(shown(container)).toEqual(ids.slice(0, INITIAL_TURNS));
    expect(idle).toEqual([]);
  });
});
