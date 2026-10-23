// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanEntry } from '@spark-outpost/contracts';
import { TurnTodo } from './TurnTodo.tsx';

afterEach(cleanup);

const entry = (content: string, status: PlanEntry['status']): PlanEntry => ({
  content,
  priority: 'medium',
  status,
});

const list = [
  entry('Find the divider', 'completed'),
  entry('Update the test', 'in_progress'),
  entry('Run the tests', 'pending'),
];

describe('the to-do card in a turn', () => {
  it('shows nothing when the agent made no list', () => {
    const { container } = render(<TurnTodo entries={[]} live />);
    expect(container.innerHTML).toBe('');
  });

  it('lists every item while the turn runs, with the current one in progress', () => {
    render(<TurnTodo entries={list} live />);
    const card = screen.getByRole('region', { name: "This turn's to-do" });
    expect(card.textContent).toContain('1 of 3');
    expect(screen.getByRole('img', { name: 'Working' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('folds to one line once the turn ends and expands from the keyboard', () => {
    render(<TurnTodo entries={list} live={false} />);
    const line = screen.getByRole('button', { name: 'To-do: 1 of 3 done · 2 not finished' });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listitem')).toBeNull();
    line.focus();
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('img', { name: 'Not finished' })).toHaveLength(2);
  });
});
