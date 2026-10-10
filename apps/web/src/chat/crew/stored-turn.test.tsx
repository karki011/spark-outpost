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
      <CrewTurn {...current} repo={null} taskCard={null} />
    </QueryClientProvider>
  );
  const view = render(tree(turn));
  return { view };
}

const board = () => screen.queryByRole('region', { name: 'Pieces' });
const messageButtons = () => screen.queryAllByRole('button', { name: /^Message / });
const parallel = (word: string) =>
  screen.getByRole('group', { name: `${word} in parallel: Bolt and Rivet` });

describe('a stored crew turn', () => {
  it('shows no piece board, no Message button on any helper and no dispatch line', () => {
    const { view } = show('succeeded');
    expect(board()).toBeNull();
    expect(messageButtons()).toEqual([]);
    expect(view.container.querySelector('.jevline')).toBeNull();
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
