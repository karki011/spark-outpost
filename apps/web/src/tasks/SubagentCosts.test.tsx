// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { queryKeys } from '../api/client.ts';
import { SubagentCosts } from './SubagentCosts.tsx';

afterEach(cleanup);

const row = (id: string, name: string, extra: Partial<SubagentRow>): SubagentRow => ({
  ...emptySubagentRecord,
  id,
  name,
  task: '',
  parentId: null,
  state: 'done',
  step: null,
  startedAt: 1_000,
  endedAt: 42_000,
  ...extra,
});

function shown(subagents: Record<string, SubagentRow[]>, runIds: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversation('chat-1'), { subagents });
  return render(
    <QueryClientProvider client={client}>
      <SubagentCosts conversationId="chat-1" runIds={runIds} />
    </QueryClientProvider>,
  );
}

describe('the sub-agent breakdown on the Cost tab', () => {
  it("lists each sub-agent of the task's runs with only what was reported", () => {
    shown(
      {
        'run-1': [
          row('a', 'Explore', {
            steps: [{ name: 'Read', done: true }],
            usage: { tokens: 34_000, costUsd: 0.04, turns: 2, model: 'gpt-6-luna', effort: 'high' },
          }),
          row('b', 'Tests', { usage: { tokens: 1_200 } }),
        ],
        'run-2': [row('c', 'Elsewhere', {})],
      },
      ['run-1'],
    );
    const items = within(screen.getByRole('list', { name: 'Usage by sub-agent' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Exploregpt-6-luna · High · 1 step · 2 turns · 34k tokens · $0.04 · 41s',
      'Tests1.2k tokens · 41s',
    ]);
  });

  it('shows nothing for a task without sub-agents', () => {
    const { container } = shown({}, ['run-1']);
    expect(container.firstChild).toBeNull();
  });
});
