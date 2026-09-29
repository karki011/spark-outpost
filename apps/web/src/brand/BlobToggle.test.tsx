// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlobToggle } from './BlobToggle.tsx';

afterEach(cleanup);

function Controlled({ onChange }: { onChange: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <BlobToggle
      label="Work like a team"
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange(next);
      }}
    />
  );
}

describe('BlobToggle', () => {
  it('is a named switch that reports its state', () => {
    render(<BlobToggle label="Spark" checked onChange={() => undefined} />);
    const toggle = screen.getByRole('switch', { name: 'Spark' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle).toHaveProperty('type', 'button');
  });

  it('flips on click and only starts its hop after the user switches it', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Work like a team' });
    expect(toggle.className).toBe('btog');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.className).toContain('btog-live');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores clicks while disabled', () => {
    const onChange = vi.fn();
    render(<BlobToggle label="Spark" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Spark' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
