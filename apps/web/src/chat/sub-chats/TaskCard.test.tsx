// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCapabilities, SubChatRow } from '@spark-outpost/contracts';
import { api } from '../../api/client.ts';
import { startedWithLine } from './started-with.ts';
import { TaskCard } from './TaskCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROW: SubChatRow = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Cart totals service',
  position: 1,
  status: 'working',
  why: null,
  task: 'Move cart totals into their own service.',
  branch: 'spark/cart-totals',
  pullRequest: null,
  startedWith: {
    provider: 'claude',
    model: 'sonnet',
    effort: 'medium',
    agentMode: 'auto',
    level: 'full-auto',
  },
  stackedOn: null,
  startsAfter: [],
  startedAt: '2026-11-20T10:00:00.000Z',
  report: null,
  reportedAt: null,
};

const CAPABILITIES = {
  models: [{ id: 'sonnet', label: 'Sonnet 5.5' }],
  efforts: [{ id: 'medium', label: 'Medium' }],
  modes: [{ id: 'auto', label: 'Auto' }],
} as unknown as ProviderCapabilities;

function show(row: SubChatRow | undefined, branch: string | null = null) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TaskCard
        parentTitle="Checkout rewrite"
        task="Move cart totals into their own service."
        row={row}
        branch={branch}
      />
    </QueryClientProvider>,
  );
  return screen.getByRole('region', { name: 'Task from Checkout rewrite' });
}

describe('the task card at the top of a sub-chat', () => {
  it('names the parent, says it is not the user’s message and shows what it started with', async () => {
    vi.spyOn(api, 'getCapabilities').mockResolvedValue(CAPABILITIES);
    const card = show(ROW);
    expect(card.textContent).toContain('Started by that chat · not your message');
    expect(card.textContent).toContain('Move cart totals into their own service.');
    await waitFor(() =>
      expect(card.textContent).toContain(
        'Started with Sonnet 5.5 · medium effort · Auto · Full auto → PR · branch spark/cart-totals',
      ),
    );
  });

  it('shows the task alone when the parent and its record are gone', () => {
    const card = show(undefined, 'spark/cart-totals');
    expect(card.textContent).toContain('Move cart totals into their own service.');
    expect(card.textContent).not.toContain('Started with');
  });

  it('words what a sub-chat started with from the ids when the agent’s lists are not loaded', () => {
    expect(startedWithLine(ROW.startedWith, undefined, null)).toBe(
      'Started with Sonnet · medium effort · auto · Full auto → PR',
    );
    expect(
      startedWithLine(
        { provider: 'claude', model: null, effort: null, agentMode: null, level: null },
        undefined,
        'spark/x',
      ),
    ).toBe('Started with Default model · branch spark/x');
  });
});
