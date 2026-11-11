// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentCards } from './AgentCards.tsx';
import { AgentsSection } from './AgentsSection.tsx';
import { AgentBoardContext, createAgentBoard } from './agent-board.ts';

const scrolled = vi.fn();

beforeEach(() => {
  scrolled.mockClear();
  Element.prototype.scrollIntoView = scrolled;
});

afterEach(cleanup);

const rows: SubagentRow[] = [
  {
    ...emptySubagentRecord,
    id: 'a',
    name: 'Server architecture',
    task: 'Map the Express server: routes and workers. Report back.',
    parentId: null,
    state: 'done',
    step: null,
    steps: [{ name: 'Read `server.ts`', done: true }],
    usage: { durationMs: 48_000, tokens: 61_000 },
    message: 'Routes live in apps/server/src/api.',
    startedAt: 1_000,
    endedAt: 49_000,
  },
  {
    ...emptySubagentRecord,
    id: 'b',
    name: 'Web state',
    task: 'Map how the React app holds state.',
    parentId: null,
    state: 'working',
    step: 'Read `chat-store.ts`',
    steps: [
      { name: 'Grep', done: true },
      { name: 'Read `chat-store.ts`', done: false },
    ],
    commands: ['grep -rn "useQuery" apps/web/src/chat'],
    startedAt: 1_000,
    endedAt: null,
  },
];

describe('AgentCards', () => {
  it('lists one card per agent with its purpose, state and progress, working ones first', () => {
    render(<AgentCards rows={rows} live />);
    const cards = within(screen.getByRole('list', { name: 'Sub-agents' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[1]!.textContent).toContain('Map the Express server: routes and workers.');
    expect(cards[1]!.textContent).toContain('48s · 61K tok');
    expect(cards[1]!.textContent).toContain('Done');
    expect(cards[0]!.dataset.state).toBe('working');
    expect(cards[0]!.textContent).toContain('Now: Read chat-store.ts');
    expect(cards[0]!.textContent).not.toContain('grep -rn');
    expect(cards[0]!.querySelectorAll('.ac-now')).toHaveLength(1);
    expect(cards[0]!.textContent).toContain('2 steps');
  });

  it('marks stale working workers inactive and offers no redirect after the turn ends', () => {
    render(<AgentCards rows={rows.slice(1)} live={false} onRedirect={() => {}} />);
    expect(screen.getByText('Inactive')).toBeTruthy();
    expect(screen.queryByText('Working')).toBeNull();
    expect(screen.queryByText(/Now:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask lead to redirect' })).toBeNull();
  });

  it('opens a card to all its steps and its report', () => {
    render(<AgentCards rows={rows} live />);
    const name = screen.getByRole('button', { name: 'Server architecture' });
    expect(name.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(name);
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('list', { name: 'Steps of Server architecture' })).toBeTruthy();
    expect(screen.getByText('Routes live in apps/server/src/api.')).toBeTruthy();
  });
});

describe('AgentsSection', () => {
  it('shows the latest turn’s agents, or the turn whose View was chosen until a newer turn starts', () => {
    const board = createAgentBoard();
    render(
      <AgentBoardContext value={board}>
        <AgentsSection />
      </AgentBoardContext>,
    );
    expect(screen.queryByRole('heading')).toBeNull();

    act(() => {
      board.show({
        runId: 'old',
        order: '2026-10-20T01:00:00Z',
        rows: rows.slice(0, 1),
        live: false,
      });
      board.show({ runId: 'new', order: '2026-10-20T02:00:00Z', rows, live: true });
    });
    expect(screen.getByRole('heading', { name: 'Agents · 2' })).toBeTruthy();

    act(() => board.open('old'));
    expect(screen.getByRole('heading', { name: 'Agents · 1' })).toBeTruthy();

    act(() => board.show({ runId: 'next', order: '2026-10-20T03:00:00Z', rows, live: true }));
    expect(screen.getByRole('heading', { name: 'Agents · 2' })).toBeTruthy();

    act(() => {
      board.forget('next');
      board.forget('new');
    });
    expect(screen.getByRole('heading', { name: 'Agents · 1' })).toBeTruthy();
  });

  it('expands, scrolls to and focuses the worker a click asked for, every time', () => {
    const board = createAgentBoard();
    render(
      <AgentBoardContext value={board}>
        <AgentsSection />
      </AgentBoardContext>,
    );
    act(() => board.show({ runId: 'run', order: '2026-10-20T02:00:00Z', rows, live: true }));
    act(() => board.open('run', 'b'));
    const name = screen.getByRole('button', { name: 'Web state' });
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Server architecture' }).getAttribute('aria-expanded'),
    ).toBe('false');

    fireEvent.click(name);
    expect(name.getAttribute('aria-expanded')).toBe('false');
    act(() => board.open('run', 'b'));
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});
