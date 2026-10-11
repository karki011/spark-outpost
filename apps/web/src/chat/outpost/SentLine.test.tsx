// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SentLine } from './SentLine.tsx';

afterEach(cleanup);

describe('SentLine', () => {
  it('is one line with the receiver, the first line of the request and its state', () => {
    const { container } = render(
      <SentLine
        post={{
          body: 'List the order fields\nand their types',
          toHandle: 'api',
          state: 'answered',
        }}
      />,
    );
    const lines = container.querySelectorAll('p');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe('To @apiList the order fieldsAnswered');
    expect(container.querySelector('.op-line-state')?.className).toContain('answered');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('follows the state of the request', () => {
    const { rerender } = render(
      <SentLine post={{ body: 'Go', toHandle: 'api', state: 'working' }} />,
    );
    expect(screen.getByText('Working')).toBeTruthy();
    rerender(<SentLine post={{ body: 'Go', toHandle: 'api', state: 'needs_you' }} />);
    expect(screen.getByText('Needs you')).toBeTruthy();
  });

  it('opens the outpost at the request', () => {
    const onOpen = vi.fn();
    render(<SentLine post={{ body: 'Go', toHandle: 'api', state: 'sent' }} onOpen={onOpen} />);
    const open = screen.getByRole('button', { name: 'Open the request to @api in the outpost' });
    expect(open).toHaveProperty('type', 'button');
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('names a receiver that left the outpost', () => {
    render(<SentLine post={{ body: 'Go', toHandle: null, state: 'failed' }} />);
    expect(screen.getByText('To a removed chat')).toBeTruthy();
  });
});
