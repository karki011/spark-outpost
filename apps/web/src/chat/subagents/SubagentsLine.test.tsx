// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAgentsContext, SubagentsLine } from './SubagentsLine.tsx';

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
    const { container } = render(<SubagentsLine rows={[]} live />);
    expect(container.firstChild).toBeNull();
  });

  it('says what it waits on in one status line, with a Scout per agent', () => {
    const { container } = render(<SubagentsLine rows={rows} live />);
    expect(screen.getByRole('status').textContent).toBe(
      'Waiting on 2 agents · 1 done · writing up when all finish',
    );
    const scouts = container.querySelectorAll('.sl-scout');
    expect(scouts).toHaveLength(3);
    expect([...scouts].map((scout) => scout.hasAttribute('data-working'))).toEqual([
      false,
      true,
      true,
    ]);
    expect(container.querySelector('.sl-scouts')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('settles every Scout once the turn has ended', () => {
    const { container } = render(<SubagentsLine rows={rows} live={false} />);
    expect(container.querySelectorAll('.sl-scout[data-working]')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('3 agents · 1 done');
  });

  it('opens the agents in the side panel', () => {
    const open = vi.fn();
    render(
      <OpenAgentsContext value={open}>
        <SubagentsLine rows={rows} live />
      </OpenAgentsContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View agents' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('shows the cards in place where there is no side panel', () => {
    render(<SubagentsLine rows={rows} live />);
    const view = screen.getByRole('button', { name: 'View agents' });
    fireEvent.click(view);
    expect(view.getAttribute('aria-expanded')).toBe('true');
    expect(view.textContent).toBe('Hide agents');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
