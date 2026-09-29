// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
