// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InfoTip } from './InfoTip.tsx';

afterEach(cleanup);

describe('InfoTip', () => {
  it('names its topic and gives screen readers the text before it opens', () => {
    render(<InfoTip topic="Check changes" text="Diffs are checked by observation only." />);
    const button = screen.getByRole('button', { name: 'More about Check changes' });
    expect(button).toHaveProperty('type', 'button');
    const describedBy = button.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Diffs are checked by observation only.',
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on click and closes on Escape without letting a dialog see the key', () => {
    render(<InfoTip topic="Check changes" text="Diffs are checked by observation only." />);
    fireEvent.click(screen.getByRole('button', { name: 'More about Check changes' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Diffs are checked by observation only.');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
  });

  it('shows options as a list and describes them as one line', () => {
    const levels = {
      lead: 'How much Spark does alone.',
      items: [
        { label: 'Review each step', text: 'You decide what to keep.' },
        { label: 'Automatic', text: 'Runs commands without asking.' },
      ],
      footer: 'Revert is always there.',
    };
    render(<InfoTip topic="Spark autonomy" text={levels} />);
    const button = screen.getByRole('button', { name: 'More about Spark autonomy' });
    expect(button.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'How much Spark does alone. Review each step: You decide what to keep. Automatic: Runs commands without asking. Revert is always there.',
    );
    fireEvent.click(button);
    const tooltip = screen.getByRole('tooltip');
    const items = within(tooltip).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('b')?.textContent)).toEqual([
      'Review each step',
      'Automatic',
    ]);
    expect(items[1]!.textContent).toBe('Automatic Runs commands without asking.');
    expect(tooltip.firstElementChild?.textContent).toBe('How much Spark does alone.');
    expect(tooltip.lastElementChild?.textContent).toBe('Revert is always there.');
  });
});
