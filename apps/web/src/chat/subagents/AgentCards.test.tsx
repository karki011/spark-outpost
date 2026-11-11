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
        leadModel: null,
      });
      board.show({
        runId: 'new',
        order: '2026-10-20T02:00:00Z',
        rows,
        live: true,
        leadModel: null,
      });
    });
    expect(screen.getByRole('heading', { name: 'Agents · 2' })).toBeTruthy();

    act(() => board.open('old'));
    expect(screen.getByRole('heading', { name: 'Agents · 1' })).toBeTruthy();

    act(() =>
      board.show({
        runId: 'next',
        order: '2026-10-20T03:00:00Z',
        rows,
        live: true,
        leadModel: null,
      }),
    );
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
    act(() =>
      board.show({
        runId: 'run',
        order: '2026-10-20T02:00:00Z',
        rows,
        live: true,
        leadModel: null,
      }),
    );
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

  it('shows the model in the meta of a working and a done card, and nothing when unknown', () => {
    const known: SubagentRow[] = [
      { ...rows[0]!, usage: { ...rows[0]!.usage, model: 'claude-opus-5-5', effort: 'high' } },
      { ...rows[1]!, usage: { model: 'gpt-5.5' } },
      { ...rows[1]!, id: 'c', name: 'Unknown model', usage: { effort: 'high' } },
    ];
    render(<AgentCards rows={known} live />);
    const card = (id: string) =>
      document.querySelector<HTMLElement>(`[data-worker-id="${id}"] .ac-meta`)!.textContent;
    expect(card('a')).toBe('Opus 5.5 · High · 48s · 61K tok');
    expect(card('b')).toBe('gpt-5.5 · 2 steps');
    expect(card('c')).toBe('2 steps');
  });

  it('tags only a card whose model is not the chat model', () => {
    const mixed: SubagentRow[] = [
      { ...rows[0]!, usage: { model: 'claude-opus-5-5' } },
      { ...rows[1]!, usage: { model: 'claude-haiku-5-5' } },
      { ...rows[1]!, id: 'c', name: 'Unknown model', usage: {} },
    ];
    render(<AgentCards rows={mixed} live leadModel="Opus 5.5" />);
    const tagged = [...document.querySelectorAll<HTMLElement>('[data-worker-id]')]
      .filter((card) => card.textContent.includes('Different model'))
      .map((card) => card.dataset.workerId);
    expect(tagged).toEqual(['b']);
  });

  it('keeps an expanded card open and focused when another worker finishes and the order changes', () => {
    const working = (id: string, name: string): SubagentRow => ({
      ...rows[1]!,
      id,
      name,
      task: `Task for ${name}`,
    });
    const first = working('x', 'First worker');
    const second = working('y', 'Second worker');
    const { rerender } = render(<AgentCards rows={[first, second]} live />);
    const name = screen.getByRole('button', { name: 'Second worker' });
    fireEvent.click(name);
    name.focus();
    const order = () =>
      within(screen.getByRole('list', { name: 'Sub-agents' }))
        .getAllByRole('listitem')
        .flatMap((item) => (item.dataset.workerId ? [item.dataset.workerId] : []));
    expect(order()).toEqual(['x', 'y']);

    rerender(<AgentCards rows={[{ ...first, state: 'done', endedAt: 9 }, second]} live />);
    expect(order()).toEqual(['y', 'x']);
    const same = screen.getByRole('button', { name: 'Second worker' });
    expect(same).toBe(name);
    expect(same.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(same);
  });
});
