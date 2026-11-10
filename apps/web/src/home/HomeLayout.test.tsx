// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeLayout } from './HomeLayout.tsx';

afterEach(cleanup);

function Harness() {
  const [lead, setLead] = useState(false);
  return (
    <HomeLayout
      entering={false}
      loading={false}
      header={<h1 id="home-greet">Headline</h1>}
      lead={lead ? <section aria-label="Lead">Lead card</section> : null}
      composer={<input aria-label="Message" />}
      board={<p>Board</p>}
      foot={
        <button type="button" onClick={() => setLead(!lead)}>
          Toggle lead
        </button>
      }
    />
  );
}

describe('HomeLayout', () => {
  it('keeps the composer, its draft and its focus when a lead appears and goes', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Message') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'half a thought' } });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle lead' }));
    expect(screen.getByLabelText('Lead')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBe(input);
    expect(input.value).toBe('half a thought');

    input.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle lead' }));
    expect(screen.queryByLabelText('Lead')).toBeNull();
    expect(screen.getByLabelText('Message')).toBe(input);
    expect(input.value).toBe('half a thought');
    expect(document.activeElement).toBe(input);
  });

  it('puts the lead after the headline and before the composer and board', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle lead' }));
    const order = [...container.querySelectorAll('h1, section, input, p')].map((node) =>
      node.tagName.toLowerCase(),
    );
    expect(order).toEqual(['h1', 'section', 'input', 'p']);
  });
});
