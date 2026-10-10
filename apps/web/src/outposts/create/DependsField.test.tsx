// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DependsField } from './DependsField.tsx';
import { PullField } from './PullField.tsx';

afterEach(cleanup);

const CHOICES = [
  { key: 'k-api', handle: 'api' },
  { key: 'k-docs', handle: 'docs' },
];

function choose(field: string, choice: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: field }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: choice }));
}

describe('DependsField', () => {
  it('shows the chat a sub-task starts after and lets it start right away', () => {
    const onChange = vi.fn();
    render(<DependsField choices={CHOICES} value="k-api" problem={null} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Starts after' }).textContent).toBe('@api');
    choose('Starts after', /^Nothing/);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('picks another chat by its key', () => {
    const onChange = vi.fn();
    render(<DependsField choices={CHOICES} value={null} problem={null} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Starts after' }).textContent).toBe('Nothing');
    choose('Starts after', /^@docs/);
    expect(onChange).toHaveBeenCalledWith('k-docs');
  });

  it('reads as nothing when the chat it pointed at is gone', () => {
    render(<DependsField choices={CHOICES} value="k-gone" problem={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Starts after' }).textContent).toBe('Nothing');
  });
});

describe('PullField', () => {
  it('names the stack and switches the chat to no pull request', () => {
    const onChange = vi.fn();
    render(<PullField level="full-auto" stackedOn="api" readOnly={false} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Pull request' }).textContent).toBe(
      'Pull request, stacked on @api',
    );
    choose('Pull request', /^No pull request/);
    expect(onChange).toHaveBeenCalledWith('hands-off');
  });

  it('reads as parallel without a parent in the same project', () => {
    render(<PullField level="full-auto" stackedOn={null} readOnly={false} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pull request' }).textContent).toBe(
      'Pull request, parallel',
    );
  });

  it('offers no pull request choice for a chat in a read-only mode', () => {
    render(<PullField level="full-auto" stackedOn="api" readOnly onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Pull request' })).toBeNull();
    expect(screen.getByText('No pull request in a read-only mode')).toBeTruthy();
  });
});
