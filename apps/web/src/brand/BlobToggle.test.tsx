// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlobToggle, type BlobKind } from './BlobToggle.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Controlled({
  kind = 'sun',
  onChange,
}: {
  kind?: BlobKind;
  onChange: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <BlobToggle
      label="Morning brief"
      kind={kind}
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange(next);
      }}
    />
  );
}

function reduceMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('BlobToggle', () => {
  it('is a named switch that reports its state', () => {
    render(<BlobToggle label="Spark" kind="spark" checked onChange={() => undefined} />);
    const toggle = screen.getByRole('switch', { name: 'Spark' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle).toHaveProperty('type', 'button');
    expect(toggle.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('wakes on click, sleeps on the next click, and only animates after the user switches it', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Morning brief' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.className).not.toContain('btog-live');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.className).toContain('btog-live');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('can be reached and pressed from the keyboard as a native button', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Morning brief' });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.tabIndex).toBe(0);
  });

  it('changes state without the jump or yawn when motion is reduced', () => {
    reduceMotion();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Morning brief' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.className).not.toContain('btog-live');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.className).not.toContain('btog-live');
  });

  it('dresses each blob for its setting', () => {
    const { rerender, container } = render(
      <BlobToggle label="Spark" kind="spark" checked onChange={() => undefined} />,
    );
    expect(container.querySelector('.btog-antenna')).not.toBeNull();
    rerender(<BlobToggle label="Morning brief" kind="sun" checked onChange={() => undefined} />);
    expect(container.querySelector('.btog-sun')).not.toBeNull();
    expect(container.querySelector('.btog-antenna')).toBeNull();
  });

  it('ignores clicks while disabled', () => {
    const onChange = vi.fn();
    render(<BlobToggle label="Spark" kind="spark" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Spark' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
