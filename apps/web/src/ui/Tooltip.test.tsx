// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTooltip } from './Tooltip.tsx';

afterEach(cleanup);

function Chip() {
  const tip = useTooltip('Push only · PR link');
  return (
    <>
      <div className="thread" data-testid="thread" />
      <div data-testid="bar">
        <button type="button" onClick={(event) => tip.show(event.currentTarget)}>
          Branch
        </button>
      </div>
      {tip.tooltip}
    </>
  );
}

function scroll(target: EventTarget) {
  act(() => {
    target.dispatchEvent(new Event('scroll'));
  });
}

describe('useTooltip', () => {
  it('stays open while an unrelated area scrolls and hides when its anchor moves', () => {
    render(<Chip />);
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Push only · PR link');

    scroll(screen.getByTestId('thread'));
    expect(screen.getByRole('tooltip')).toBeTruthy();

    scroll(screen.getByTestId('bar'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides when the page scrolls', () => {
    render(<Chip />);
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    scroll(document);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
