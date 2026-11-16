// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeLayout } from './HomeLayout.tsx';

afterEach(cleanup);

function Harness() {
  const [needs, setNeeds] = useState(false);
  return (
    <HomeLayout
      entering={false}
      loading={false}
      header={<h1 id="home-greet">Headline</h1>}
      composer={<input aria-label="Message" />}
      foot={
        <button type="button" onClick={() => setNeeds(!needs)}>
          Toggle needs
        </button>
      }
    >
      {needs && <section aria-label="Needs you">A waiting card</section>}
      <p>Working set</p>
    </HomeLayout>
  );
}

describe('HomeLayout', () => {
  it('keeps the composer, its draft and its focus when Needs you appears and goes', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Message') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'half a thought' } });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle needs' }));
    expect(screen.getByLabelText('Needs you')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBe(input);
    expect(input.value).toBe('half a thought');

    input.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle needs' }));
    expect(screen.queryByLabelText('Needs you')).toBeNull();
    expect(screen.getByLabelText('Message')).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it('puts the composer right under the headline, before what needs you', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle needs' }));
    const order = [...container.querySelectorAll('h1, section, input, p')].map((node) =>
      node.tagName.toLowerCase(),
    );
    expect(order).toEqual(['h1', 'input', 'section', 'p']);
  });
});
