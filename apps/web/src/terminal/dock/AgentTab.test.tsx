// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTerminal, CreateShellResponse } from '@spark-outpost/contracts';
import type { TerminalHandlers } from '../terminal-connection.ts';
import {
  agentTerminalFixture as terminal,
  FIXTURE_CHAT as CHAT,
  FIXTURE_TERMINAL as ID,
} from './agent-terminal-fixture.ts';

interface FakeConnection {
  handlers: TerminalHandlers<CreateShellResponse>;
  element: HTMLElement;
  disposed: boolean;
}

const RELOADED = '01990000-0000-7000-8000-000000000011';
const CLOSED = '01990000-0000-7000-8000-000000000012';

const opened: FakeConnection[] = [];
let listed: AgentTerminal[] = [];
const viewRoute = vi.fn();
const stopRoute = vi.fn<(chatId: string, id: string) => Promise<AgentTerminal>>();
const outputRoute = vi.fn(() => Promise.resolve({ output: 'saved tail\n', outputChars: 11 }));
const busyRoute = vi.fn(() => Promise.resolve('pnpm dev'));

vi.mock('../../api/agent-terminals.ts', () => ({
  agentTerminalKeys: {
    all: ['agent-terminals'],
    chat: (chatId: string) => ['agent-terminals', 'chat', chatId],
    output: (chatId: string, id: string) => ['agent-terminals', 'output', chatId, id],
  },
  agentTerminalsApi: {
    list: () => Promise.resolve(listed),
    output: () => outputRoute(),
    view: (chatId: string, id: string) => viewRoute(chatId, id) as Promise<CreateShellResponse>,
    stop: (chatId: string, id: string) => stopRoute(chatId, id),
  },
}));

vi.mock('../../chat/commands/CommandScreen.tsx', () => ({
  CommandScreen: ({ text }: { text: string }) => (
    <div role="group" aria-label="Command output" tabIndex={0}>
      {text}
    </div>
  ),
}));

vi.mock('../terminal-api.ts', () => ({
  createShell: () => new Promise(() => undefined),
  runningCommand: () => busyRoute(),
}));

vi.mock('../terminal-connection.ts', () => ({
  preloadTerminal: () => Promise.resolve(),
  openTerminal: (
    start: () => Promise<CreateShellResponse>,
    element: HTMLElement,
    handlers: TerminalHandlers<CreateShellResponse>,
  ) => {
    const connection: FakeConnection = { handlers, element, disposed: false };
    opened.push(connection);
    void start();
    return {
      run: () => undefined,
      notice: () => undefined,
      fit: () => undefined,
      focus: () => undefined,
      close: () => undefined,
      dispose: () => {
        connection.disposed = true;
      },
    };
  },
}));

const { TerminalDock } = await import('./TerminalDock.tsx');
const { useRestoredAgentTabs } = await import('./use-agent-tabs.ts');
const store = await import('./shell-store.ts');

let client: QueryClient;

function Chat() {
  useRestoredAgentTabs(CHAT);
  return <TerminalDock chatId={CHAT} />;
}

function show() {
  return render(
    <QueryClientProvider client={client}>
      <Chat />
    </QueryClientProvider>,
  );
}

function attach(connection: FakeConnection) {
  act(() =>
    connection.handlers.onOpen({
      id: 'view-1',
      token: 't',
      cwd: '/work/widgets',
      label: 'pnpm dev',
      kind: 'project',
      note: null,
    }),
  );
}

const tabButton = () =>
  screen.findByRole('button', { name: 'Claude · pnpm dev, run by the agent' });
const pane = () => screen.getByRole('group', { name: /, run by the agent, read-only$/ });
const tabs = () => store.chatOf(CHAT).tabs;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listed = [terminal()];
  opened.length = 0;
  viewRoute.mockReset().mockReturnValue(new Promise(() => undefined));
  stopRoute.mockReset();
  outputRoute.mockClear();
  busyRoute.mockClear();
});

afterEach(() => {
  act(() => {
    for (const tab of [...tabs()]) store.closeShell(CHAT, tab.id);
    store.hideShells(CHAT);
  });
  cleanup();
});

describe('an agent tab in the dock', () => {
  it('opens a read-only view through the view route once it is shown', async () => {
    show();
    act(() => store.openAgentTab(CHAT, ID));
    const tab = await tabButton();
    expect(tab.getAttribute('aria-pressed')).toBe('true');
    expect(tab.querySelector('.term-tab-agent')).not.toBeNull();
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(viewRoute).toHaveBeenCalledWith(CHAT, ID);
    expect(opened[0]!.handlers.readOnly).toBe(true);
    expect(opened[0]!.element.className).toBe('agent-tab-screen');
    await waitFor(() => expect(tab.querySelector('.term-light.open')).not.toBeNull());
    expect(pane().textContent).toContain('Run by the agent · read-only');
    expect(screen.getByRole('status').textContent).toMatch(/Closing the tab does not stop it\.$/);
  });

  it('opens one tab per terminal', async () => {
    show();
    act(() => store.openAgentTab(CHAT, ID));
    act(() => store.openAgentTab(CHAT, ID));
    await tabButton();
    expect(tabs()).toHaveLength(1);
  });

  it('stops through the stop route and then says how it ended, keeping what it showed', async () => {
    const stopped = terminal({
      state: 'stopped',
      stoppedBy: 'user',
      endedAt: '2026-10-09T10:01:00.000Z',
    });
    stopRoute.mockImplementation(() => {
      listed = [stopped];
      return Promise.resolve(stopped);
    });
    show();
    act(() => store.openAgentTab(CHAT, ID));
    await waitFor(() => expect(opened).toHaveLength(1));
    attach(opened[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('How it ended: stopped by you.'),
    );
    expect(stopRoute).toHaveBeenCalledWith(CHAT, ID);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(opened[0]!.disposed).toBe(false);
    expect(opened[0]!.element.hidden).toBe(false);
    expect(outputRoute).not.toHaveBeenCalled();
    expect((await tabButton()).querySelector('.term-light.ended')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a new terminal' })).toBeNull();
  });

  it('closes without asking and without stopping the command', async () => {
    show();
    act(() => store.openAgentTab(CHAT, ID));
    await waitFor(() => expect(opened).toHaveLength(1));
    attach(opened[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Close Claude · pnpm dev' }));
    await waitFor(() => expect(tabs()).toHaveLength(0));
    expect(busyRoute).not.toHaveBeenCalled();
    expect(stopRoute).not.toHaveBeenCalled();
    expect(opened[0]!.disposed).toBe(true);
  });

  it('says plainly when no view can open, keeps Stop and tries again when asked', async () => {
    viewRoute.mockRejectedValueOnce(
      new Error('Too many terminal views are open. Close one first.'),
    );
    show();
    act(() => store.openAgentTab(CHAT, ID));
    await waitFor(() => expect(opened).toHaveLength(1));
    act(() => opened[0]!.handlers.onError('Too many terminal views are open. Close one first.'));
    expect(screen.getByRole('alert').textContent).toContain(
      'The output can’t be shown in this tab: Too many terminal views are open. Close one first. The command is still running.',
    );
    expect(opened[0]!.disposed).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(opened).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the saved output and the ending of a terminal that is over', async () => {
    listed = [terminal({ state: 'exited', exitCode: 2, endedAt: '2026-10-09T10:00:30.000Z' })];
    show();
    act(() => store.openAgentTab(CHAT, ID));
    expect((await screen.findByRole('group', { name: 'Command output' })).textContent).toBe(
      'saved tail\n',
    );
    expect(screen.getByRole('status').textContent).toBe('How it ended: exit 2.');
    expect(pane().querySelector('.cmd-tab-state')!.textContent).toBe('exit 2 · 30s');
    expect(opened).toHaveLength(0);
    expect(viewRoute).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('agent tabs after a reload', () => {
  it('are rebuilt for the running terminals without opening the dock or a view', async () => {
    listed = [
      terminal({ id: RELOADED }),
      terminal({ id: '01990000-0000-7000-8000-000000000002', state: 'exited', exitCode: 0 }),
    ];
    show();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(tabs()[0]).toMatchObject({ kind: 'agent', agentTerminalId: RELOADED });
    await waitFor(() => expect(tabs()[0]!.status).toBe('open'));
    expect(store.chatOf(CHAT).open).toBe(false);
    expect(opened).toHaveLength(0);
    act(() => store.showShells(CHAT));
    await waitFor(() => expect(opened).toHaveLength(1));
  });

  it('do not come back for a tab the user closed, until it is opened from the row', async () => {
    listed = [terminal({ id: CLOSED })];
    show();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    act(() => store.closeShell(CHAT, tabs()[0]!.id));
    await act(() => client.invalidateQueries({ queryKey: ['agent-terminals', 'chat', CHAT] }));
    expect(tabs()).toHaveLength(0);
    act(() => store.openAgentTab(CHAT, CLOSED));
    expect(tabs()).toHaveLength(1);
  });
});
