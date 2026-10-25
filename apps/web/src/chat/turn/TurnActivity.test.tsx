// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptySubagentRecord, type Run, type SubagentRow } from '@spark-outpost/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenAgentsContext } from '../subagents/SubagentsLine.tsx';
import { TurnActivity } from './TurnActivity.tsx';

afterEach(cleanup);

const run = { id: 'run', createdAt: '2026-10-24T12:00:00Z', startedAt: null, usage: null } as Run;
const rows: SubagentRow[] = ['Builder', 'Verifier'].map((name) => ({
  ...emptySubagentRecord,
  id: name,
  name,
  task: name,
  parentId: null,
  state: 'working',
  step: null,
  startedAt: null,
  endedAt: null,
}));

it('shows individual workers below the running status and opens Work', () => {
  const open = vi.fn();
  const { container } = render(
    <OpenAgentsContext value={open}>
      <TurnActivity
        run={run}
        subagents={rows}
        working
        waiting={false}
        background={null}
        commands={[]}
      />
    </OpenAgentsContext>,
  );
  expect(screen.getByText('Running 2 agents')).toBeTruthy();
  expect(screen.getByText('Builder')).toBeTruthy();
  expect(screen.getByText('Verifier')).toBeTruthy();
  expect(container.querySelector('.turn-working .sl')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View agents' }));
  expect(open).toHaveBeenCalledExactlyOnceWith('run');
});

it('keeps details accessible while the lead continues after its workers finish', () => {
  render(
    <TurnActivity
      run={run}
      subagents={rows.map((row) => ({ ...row, state: 'done' }))}
      working
      waiting={false}
      background={null}
      commands={[]}
    />,
  );
  expect(screen.getByText('Working')).toBeTruthy();
  expect(screen.queryByText(/writing up/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View agents' }));
  expect(
    within(screen.getByRole('list', { name: 'Sub-agents' })).getAllByRole('listitem'),
  ).toHaveLength(2);
});

it.each([
  { agents: 1, tasks: 0, names: ['Builder'] },
  { agents: 0, tasks: 0, names: [], wakesAt: Date.now() + 60000 },
])('keeps background and sleep controls without a competing running line', (background) => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <TurnActivity
        run={run}
        subagents={rows}
        working
        waiting={false}
        background={background}
        commands={[]}
      />
    </QueryClientProvider>,
  );
  expect(container.querySelector('.turn-working')).toBeNull();
  expect(screen.getAllByRole('status')).toHaveLength(2);
  expect(
    screen.getByRole('button', {
      name: background.agents ? 'Stop background tasks' : 'Stop waiting',
    }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'View agents' })).toBeTruthy();
});

it.each([true, false])(
  'retains worker access when waiting=%s and no active status is shown',
  (waiting) => {
    const { container } = render(
      <TurnActivity
        run={run}
        subagents={rows}
        working={waiting}
        waiting={waiting}
        background={null}
        commands={[]}
      />,
    );
    expect(container.querySelector('.turn-working')).toBeNull();
    expect(screen.getByRole('button', { name: 'View agents' })).toBeTruthy();
  },
);
