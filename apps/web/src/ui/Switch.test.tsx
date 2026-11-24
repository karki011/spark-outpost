// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch.tsx';
import { SwitchWordsProvider } from './switch-words.ts';

afterEach(cleanup);

function Controlled({ onChange }: { onChange: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      label="Morning brief"
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange(next);
      }}
    />
  );
}

describe('Switch', () => {
  it('is a named switch that reports its state', () => {
    render(<Switch label="Spark" checked onChange={() => undefined} />);
    const toggle = screen.getByRole('switch', { name: 'Spark' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle).toHaveProperty('type', 'button');
    expect(toggle.querySelector('.switch-track')?.getAttribute('aria-hidden')).toBe('true');
    expect(toggle.querySelector('svg')).toBeNull();
  });

  it('turns on with a click and off with the next', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Morning brief' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('can be reached from the keyboard as a native button', () => {
    render(<Controlled onChange={() => undefined} />);
    const toggle = screen.getByRole('switch', { name: 'Morning brief' });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.tabIndex).toBe(0);
  });

  it('says On or Off beside the track when words are on', () => {
    const { rerender } = render(
      <SwitchWordsProvider value>
        <Switch label="Spark" checked onChange={() => undefined} />
      </SwitchWordsProvider>,
    );
    expect(screen.getByRole('switch').textContent).toBe('On');
    rerender(
      <SwitchWordsProvider value>
        <Switch label="Spark" checked={false} onChange={() => undefined} />
      </SwitchWordsProvider>,
    );
    expect(screen.getByRole('switch').textContent).toBe('Off');
  });

  it('ignores clicks while disabled', () => {
    const onChange = vi.fn();
    render(<Switch label="Spark" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Spark' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
