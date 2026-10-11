// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTerminal } from '@spark-outpost/contracts';
import {
  agentTerminalFixture as terminal,
  FIXTURE_CHAT as CHAT,
  FIXTURE_TERMINAL as ID,
} from '../../terminal/dock/agent-terminal-fixture.ts';

const openTab = vi.fn();
const stopRoute = vi.fn<(chatId: string, id: string) => Promise<AgentTerminal>>();

vi.mock('../../terminal/dock/shell-store.ts', () => ({
  openAgentTab: (chatId: string, id: string) => openTab(chatId, id),
}));

vi.mock('../../api/agent-terminals.ts', () => ({
  agentTerminalKeys: { chat: (chatId: string) => ['agent-terminals', 'chat', chatId] },
  agentTerminalsApi: { stop: (chatId: string, id: string) => stopRoute(chatId, id) },
}));

const { AgentTerminalRow, AgentTerminalsRunning } = await import('./AgentTerminalRow.tsx');
const { CommandDockContext } = await import('./command-dock.ts');

let client: QueryClient;

function show(item: AgentTerminal, dockChatId: string | null = CHAT) {
  return render(
    <QueryClientProvider client={client}>
      <CommandDockContext value={dockChatId}>
        <AgentTerminalRow terminal={item} />
      </CommandDockContext>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  openTab.mockClear();
  stopRoute.mockReset();
});

afterEach(cleanup);

const row = () => screen.getByRole('region', { name: 'Agent terminal: pnpm dev' });

describe('the row for a command Spark runs for the agent', () => {
  it('shows the command, that it is an agent terminal and that it is running', () => {
    show(terminal());
    expect(row().textContent).toContain('pnpm dev');
    expect(row().textContent).toContain('Agent terminal');
    expect(row().querySelector('.run-cmd-state')!.textContent).toMatch(/^running · /);
    expect(row().querySelector('.spin')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Agent terminal running pnpm dev');
  });

  it('opens its dock tab', () => {
    show(terminal());
    fireEvent.click(screen.getByRole('button', { name: 'Open in terminal' }));
    expect(openTab).toHaveBeenCalledWith(CHAT, ID);
  });

  it('stops through the stop route and puts the answer in the chat’s list', async () => {
    const stopped = terminal({
      state: 'stopped',
      stoppedBy: 'user',
      endedAt: '2026-10-09T10:00:05.000Z',
    });
    stopRoute.mockResolvedValue(stopped);
    client.setQueryData(['agent-terminals', 'chat', CHAT], [terminal()]);
    show(terminal());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(stopRoute).toHaveBeenCalledWith(CHAT, ID));
    await waitFor(() =>
      expect(client.getQueryData<AgentTerminal[]>(['agent-terminals', 'chat', CHAT])).toEqual([
        stopped,
      ]),
    );
  });

  it('says so when the stop fails and keeps Stop', async () => {
    stopRoute.mockRejectedValue(new Error('The server could not be reached.'));
    show(terminal());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t stop it: The server could not be reached.',
    );
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it.each([
    [{ state: 'exited', exitCode: 0 }, /^exit 0 · /],
    [{ state: 'exited', exitCode: 1 }, /^exit 1 · /],
    [{ state: 'stopped', stoppedBy: 'user' }, /^stopped by you · /],
    [{ state: 'stopped', stoppedBy: 'agent' }, /^stopped by the agent · /],
    [{ state: 'stopped', stoppedBy: 'turn_stopped' }, /^stopped with the turn · /],
    [{ state: 'stopped', stoppedBy: 'quit' }, /^stopped when Spark quit · /],
    [{ state: 'interrupted' }, /^stopped when Spark quit · /],
    [{ state: 'failed' }, /^could not start$/],
  ] as const)('says how it ended: %o', (change, text) => {
    show(terminal({ ...change, endedAt: '2026-10-09T10:00:05.000Z' }));
    expect(row().querySelector('.run-cmd-state')!.textContent).toMatch(text);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in terminal' })).toBeTruthy();
    expect(row().querySelector('.spin')).toBeNull();
  });

  it('is text only on a paired device: no Open in terminal and no Stop', () => {
    show(terminal(), null);
    expect(row().querySelector('.run-cmd-state')!.textContent).toMatch(/^running · /);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

describe('the end-of-turn line', () => {
  it('counts the terminals still running and goes away when none is', () => {
    const second = terminal({ id: '01990000-0000-7000-8000-000000000002', state: 'starting' });
    const { rerender, container } = render(<AgentTerminalsRunning terminals={[terminal()]} />);
    expect(container.textContent).toBe('1 agent terminal still running.');
    rerender(<AgentTerminalsRunning terminals={[terminal(), second]} />);
    expect(container.textContent).toBe('2 agent terminals still running.');
    rerender(<AgentTerminalsRunning terminals={[terminal({ state: 'exited', exitCode: 0 })]} />);
    expect(container.textContent).toBe('');
  });
});
