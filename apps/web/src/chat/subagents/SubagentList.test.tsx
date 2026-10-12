// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SubagentList } from './SubagentList.tsx';

afterEach(cleanup);

const rows: SubagentRow[] = [
  {
    ...emptySubagentRecord,
    id: 'a',
    name: 'Explore',
    task: 'Find the routes',
    parentId: null,
    state: 'working',
    step: 'Read `routes.ts`',
    startedAt: 1_000,
    endedAt: null,
  },
  {
    ...emptySubagentRecord,
    id: 'b',
    name: 'Tests',
    task: 'Run the tests',
    parentId: null,
    state: 'done',
    step: null,
    startedAt: 1_000,
    endedAt: 13_000,
  },
  {
    ...emptySubagentRecord,
    id: 'c',
    name: 'Lint',
    task: 'Lint',
    parentId: 'a',
    state: 'failed',
    step: null,
    startedAt: null,
    endedAt: null,
  },
];

const summary = () => screen.getByRole('button', { name: /sub-agents? ·/ });

describe('SubagentList', () => {
  it('renders nothing for a turn without sub-agents', () => {
    const { container } = render(<SubagentList rows={[]} live />);
    expect(container.firstChild).toBeNull();
  });

  it('counts the sub-agents and lists each with its task, step and state', () => {
    render(<SubagentList rows={rows} live />);
    expect(summary().textContent).toBe('3 sub-agents · 1 working, 1 done, 1 failed');
    const items = within(screen.getByRole('list', { name: 'Sub-agents' })).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('.sa-name')?.textContent)).toEqual([
      'Explore',
      'Lint',
      'Tests',
    ]);
    expect(items[0]!.textContent).toContain('Working');
    expect(items[0]!.textContent).toContain('Read routes.ts');
    expect(items[0]!.textContent).toContain('Find the routes');
    expect(within(items[0]!).getByRole('img', { name: 'In progress' })).toBeTruthy();
    expect(items[1]!.dataset.nested).toBe('true');
    expect(items[1]!.querySelector('.sa-task')).toBeNull();
    expect(items[2]!.textContent).toContain('Done');
    expect(items[2]!.textContent).toContain('12s');
  });

  it('opens what a sub-agent did from a button on its row', () => {
    const long = `Find the routes. ${'Read every file under api. '.repeat(8)}`.trim();
    const worked: SubagentRow = {
      ...rows[1]!,
      task: long,
      steps: [
        { name: 'Read `routes.ts`', done: true },
        { name: 'Edit `routes.ts`', done: true },
      ],
      files: ['/work/app/src/routes.ts'],
      commands: ['pnpm test'],
      usage: { tokens: 34_000, toolUses: 2, costUsd: 0.04, durationMs: 41_000 },
      message: 'Moved 4 routes.\nAll tests pass.',
    };
    render(<SubagentList rows={[worked, rows[2]!]} live={false} />);
    const item = screen.getAllByRole('listitem')[0]!;
    expect(item.textContent).toContain('2 steps · 34k tokens · $0.04 · 41s');
    const toggle = screen.getByRole('button', { name: 'Tests' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(detail.textContent).toContain(long);
    const steps = within(detail).getByRole('list', { name: 'Steps of Tests' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual(['Read routes.ts', 'Edit routes.ts']);
    expect(detail.textContent).toContain('Changed routes.ts');
    expect(detail.textContent).toContain('Ran pnpm test');
    expect(detail.textContent).toContain('Its reportMoved 4 routes.\nAll tests pass.');
    expect(document.activeElement).toBe(toggle);
    expect(screen.queryByRole('button', { name: 'Lint' })).toBeNull();
  });

  it('folds and unfolds from the keyboard-reachable summary and keeps focus there', () => {
    render(<SubagentList rows={rows} live />);
    const toggle = summary();
    toggle.focus();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Sub-agents' })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('keeps the same rows and focus when a streamed update arrives', () => {
    const { rerender } = render(<SubagentList rows={rows} live />);
    const toggle = summary();
    toggle.focus();
    const first = screen.getAllByRole('listitem')[0];
    rerender(<SubagentList rows={[{ ...rows[0]!, step: 'Read `b.ts`' }, ...rows.slice(1)]} live />);
    expect(screen.getAllByRole('listitem')[0]).toBe(first);
    expect(first!.textContent).toContain('Read b.ts');
    expect(document.activeElement).toBe(toggle);
  });

  it('shows a sub-agent of a stopped turn as not finished instead of spinning', () => {
    render(<SubagentList rows={[{ ...rows[0]!, state: 'cancelled', step: null }]} live={false} />);
    expect(screen.getByRole('img', { name: 'Not finished' })).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toContain('Cancelled');
  });
});
