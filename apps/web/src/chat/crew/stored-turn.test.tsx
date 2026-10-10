// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@spark-outpost/contracts';
import { CrewTurn } from './CrewTurn.tsx';
import { crewTurn } from './stored-turn-fixture.ts';

class QuietEventSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('EventSource', QuietEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(status: Run['status']) {
  const turn = crewTurn(status);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (current: ReturnType<typeof crewTurn>) => (
    <QueryClientProvider client={client}>
      <CrewTurn {...current} repo={null} taskCard={null} continued={false} />
    </QueryClientProvider>
  );
  const view = render(tree(turn));
  return { view, rerender: (next: Run['status']) => view.rerender(tree(crewTurn(next))) };
}

const board = () => screen.queryByRole('region', { name: 'Pieces' });
const messageButtons = () => screen.queryAllByRole('button', { name: /^Message / });
const parallel = (word: string) =>
  screen.getByRole('group', { name: `${word} in parallel: Bolt and Rivet` });

describe('a crew turn that was finished when the chat opened', () => {
  it('shows no piece board and no Message button on any helper', () => {
    show('succeeded');
    expect(board()).toBeNull();
    expect(messageButtons()).toEqual([]);
  });

  it("keeps the transcript: each helper's reply, model and cost, and the turn total", () => {
    const { view } = show('succeeded');
    const group = parallel('Worked');
    expect(
      within(group)
        .getAllByRole('button')
        .map((head) => head.textContent),
    ).toEqual([
      'BoltP1 · shared tree · owns 1 fileDone',
      'RivetP2 · shared tree · owns 1 fileDone',
    ]);
    expect(view.container.querySelector('[data-agent]')?.textContent).toContain(
      'Here is the split.',
    );
    expect(view.container.querySelector('.crew-foot')?.textContent).toBe(
      'Done 3 agents · 38.1K tokens · $0.09 · Jev ~<$0.001',
    );
    expect(view.container.querySelector('.jevline')?.textContent).toContain('Plan, then build');
  });

  it('opens a helper to its reply, model and cost, still with no Message button', () => {
    const { view } = show('succeeded');
    fireEvent.click(within(parallel('Worked')).getByRole('button', { name: /Bolt/ }));
    const bolt = view.container.querySelector('.par-body [data-agent]')!;
    expect(bolt.textContent).toContain('Store built with a Map.');
    expect(bolt.querySelector('.ah-meta')?.textContent).toContain('Sonnet 5');
    expect(bolt.querySelector('.ah-meta')?.textContent).toContain('$0.03');
    expect(messageButtons()).toEqual([]);
  });

  it('keeps a message the user sent a helper during the turn and the saved plan line', () => {
    const { view } = show('succeeded');
    const steered = view.container.querySelector('.msg.me.steered')!;
    expect(steered.textContent).toContain('Use a Map for the store');
    expect(view.container.textContent).toContain('Plan saved · 2 pieces');
  });

  it('keeps a card the user already answered', () => {
    const { view } = show('succeeded');
    fireEvent.click(within(parallel('Worked')).getByRole('button', { name: /Bolt/ }));
    expect(view.container.querySelector('.par-body')?.textContent).toContain('Which store?');
  });
});

describe('a crew turn that is running when the chat opens', () => {
  it('shows the piece board and a Message button for each working helper, as before', () => {
    show('running');
    expect(within(board()!).getAllByRole('listitem')).toHaveLength(2);
    expect(messageButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Message Bolt',
      'Message Rivet',
    ]);
  });

  it('keeps the piece board and Message when the turn finishes while it is on screen', () => {
    const { rerender } = show('running');
    rerender('succeeded');
    expect(board()).not.toBeNull();
    fireEvent.click(within(parallel('Worked')).getByRole('button', { name: /Bolt/ }));
    expect(messageButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Message Bolt',
    ]);
  });
});
