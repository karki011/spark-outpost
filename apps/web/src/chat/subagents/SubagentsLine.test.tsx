// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAgentsContext, SubagentsLine } from './SubagentsLine.tsx';

const scrolled = vi.fn();

beforeEach(() => {
  scrolled.mockClear();
  Element.prototype.scrollIntoView = scrolled;
});

afterEach(cleanup);

function row(id: string, state: SubagentRow['state']): SubagentRow {
  return {
    ...emptySubagentRecord,
    id,
    name: `Agent ${id}`,
    task: 'Look around.',
    parentId: null,
    state,
    step: null,
    startedAt: null,
    endedAt: null,
  };
}

const rows = [row('a', 'done'), row('b', 'working'), row('c', 'working')];

describe('SubagentsLine', () => {
  it('renders nothing without sub-agents', () => {
    const { container } = render(<SubagentsLine runId="run-1" rows={[]} live />);
    expect(container.firstChild).toBeNull();
  });

  it('shows every worker with its identity, role and current status', () => {
    const workers = [
      { ...row('a', 'working'), name: 'Builder: composer' },
      { ...row('b', 'done'), name: 'Verifier' },
      row('c', 'failed'),
      row('d', 'cancelled'),
      row('e', 'done'),
      row('f', 'working'),
    ];
    const { container } = render(<SubagentsLine runId="run-all" rows={workers} live />);
    const list = screen.getByRole('list', { name: 'Agent progress' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.getAttribute('data-worker-id'))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
    expect(within(items[0]!).getByRole('button').getAttribute('title')).toBe(
      'Builder: composer · Look around.',
    );
    expect(within(items[2]!).getByText('Agent c')).toBeTruthy();
    expect(within(items[0]!).getByText('Builder')).toBeTruthy();
    expect(within(items[1]!).queryByText('Verifier')).toBeNull();
    expect(within(items[1]!).getByRole('button', { name: 'Verifier, Done' })).toBeTruthy();
    expect(container.querySelectorAll('.sl-worker .chat-face')).toHaveLength(6);
    expect(
      [...container.querySelectorAll('.sl-state')].map((element) => element.textContent),
    ).toEqual(['Working', 'Failed', 'Stopped', 'Working']);
    expect(screen.getByRole('status').classList.contains('sr-only')).toBe(true);
  });

  it('does not imply that a stale worker is still working once the turn has ended', () => {
    const { container } = render(<SubagentsLine runId="run-1" rows={rows} live={false} />);
    expect(container.querySelectorAll('.sl-scout[data-working]')).toHaveLength(0);
    expect(screen.queryByText('Working')).toBeNull();
    expect(screen.getAllByText('Inactive')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('3 agents · 1 done');
  });

  it('folds into one chip once every worker is done and keeps the row while one runs', () => {
    const builders = ['a', 'b', 'c'].map((id) => ({ ...row(id, 'done'), name: `Builder ${id}` }));
    const { container, rerender } = render(<SubagentsLine runId="run-1" rows={builders} live />);
    expect(container.querySelector('.sl-done')?.textContent).toBe('3 builders done');
    expect(container.querySelectorAll('.sl-worker')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'View agents' })).toBeTruthy();

    rerender(<SubagentsLine runId="run-1" rows={[...builders.slice(1), row('d', 'done')]} live />);
    expect(container.querySelector('.sl-done')?.textContent).toBe('3 agents done');

    rerender(<SubagentsLine runId="run-1" rows={[...builders, row('d', 'failed')]} live />);
    expect(container.querySelector('.sl-done')).toBeNull();
    rerender(<SubagentsLine runId="run-1" rows={[...builders, row('d', 'working')]} live />);
    expect(container.querySelectorAll('.sl-worker')).toHaveLength(4);

    rerender(<SubagentsLine runId="run-1" rows={builders.slice(0, 1)} live />);
    expect(container.querySelector('.sl-done')?.textContent).toBe('1 builder done');
  });

  it('opens the agents in the side panel', () => {
    const open = vi.fn();
    render(
      <OpenAgentsContext value={open}>
        <SubagentsLine runId="run-1" rows={rows} live />
      </OpenAgentsContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View agents' }));
    expect(open).toHaveBeenCalledExactlyOnceWith('run-1');
  });

  it('opens the side panel on the clicked worker', () => {
    const open = vi.fn();
    render(
      <OpenAgentsContext value={open}>
        <SubagentsLine runId="run-1" rows={rows} live />
      </OpenAgentsContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agent b, Working' }));
    expect(open).toHaveBeenCalledExactlyOnceWith('run-1', 'b');
  });

  it('shows the cards in place where there is no side panel', () => {
    render(<SubagentsLine runId="run-1" rows={rows} live />);
    const view = screen.getByRole('button', { name: 'View agents' });
    fireEvent.click(view);
    expect(view.getAttribute('aria-expanded')).toBe('true');
    expect(view.textContent).toBe('Hide agents');
    expect(
      within(screen.getByRole('list', { name: 'Sub-agents' })).getAllByRole('listitem'),
    ).toHaveLength(3);
  });

  it('opens the cards in place with the clicked worker expanded', () => {
    const detailed = rows.map((entry) => ({
      ...entry,
      steps: [{ name: 'Read `a.ts`', done: true }],
    }));
    render(<SubagentsLine runId="run-1" rows={detailed} live />);
    fireEvent.click(screen.getByRole('button', { name: 'Agent c, Working' }));
    const names = [
      ...screen.getByRole('list', { name: 'Sub-agents' }).querySelectorAll('.ac-name'),
    ];
    expect(names.map((name) => name.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(document.activeElement).toBe(names[1]);
    expect(scrolled).toHaveBeenCalled();
  });

  describe('with more than four workers', () => {
    const six = [
      ...['a', 'b', 'c', 'd'].map((id) => ({ ...row(id, 'done'), name: 'Builder' })),
      { ...row('e', 'working'), name: 'Builder' },
      { ...row('f', 'failed'), name: 'Reviewer' },
    ];

    it('rolls up into a summary and one face button per worker', () => {
      const { container } = render(<SubagentsLine runId="run-six" rows={six} live />);
      expect(container.querySelector('.sl-summary')?.textContent).toBe(
        '5 Builders, 1 Reviewer · 4 done · 1 working · 1 failed',
      );
      const list = screen.getByRole('list', { name: 'Agent progress' });
      const items = within(list).getAllByRole('listitem');
      expect(items.map((item) => item.getAttribute('data-worker-id'))).toEqual([
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
      ]);
      expect(within(list).getAllByRole('button')).toHaveLength(6);
      expect(within(items[0]!).getByRole('button').textContent).toBe('');
      expect(within(items[0]!).getByRole('button', { name: 'Builder, Done' })).toBeTruthy();
      expect(within(items[4]!).getByText('Working')).toBeTruthy();
      expect(within(items[5]!).getByText('Failed')).toBeTruthy();
      expect(within(items[5]!).getByText('Reviewer')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'View agents' })).toBeTruthy();
    });

    it('opens the clicked worker from its face', () => {
      const open = vi.fn();
      render(
        <OpenAgentsContext value={open}>
          <SubagentsLine runId="run-six" rows={six} live />
        </OpenAgentsContext>,
      );
      fireEvent.click(screen.getAllByRole('button', { name: 'Builder, Done' })[0]!);
      fireEvent.click(screen.getByRole('button', { name: 'Reviewer, Failed' }));
      expect(open.mock.calls).toEqual([
        ['run-six', 'a'],
        ['run-six', 'f'],
      ]);
    });

    it('keeps three workers as they were', () => {
      const { container } = render(<SubagentsLine runId="run-three" rows={rows} live />);
      expect(container.querySelector('.sl-summary')).toBeNull();
      expect(container.querySelectorAll('.sl-worker')).toHaveLength(3);
      expect(
        within(screen.getByRole('list', { name: 'Agent progress' })).getAllByRole('button'),
      ).toHaveLength(3);
    });
  });
});
