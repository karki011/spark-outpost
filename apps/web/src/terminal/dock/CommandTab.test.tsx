// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandRun, ConversationDetail } from '@spark-outpost/contracts';
import type { LiveCommand } from '../../chat/commands/command-model.ts';

const CHAT = 'chat-a';
const RUN = '01990000-0000-7000-8000-0000000000aa';
const ID = '01990000-0000-7000-8000-000000000001';

const stream = { status: 'connecting', commands: [] as LiveCommand[] };
const streams: { runId: string; live: boolean }[] = [];
const stopTurn = vi.fn();
const fetchOutput = vi.fn((_runId: string, _id: string) =>
  Promise.resolve({ output: 'saved tail\n', outputChars: 11 }),
);

vi.mock('../../chat/use-run-stream.ts', () => ({
  useRunStream: (runId: string, _chatId: string, live: boolean) => {
    streams.push({ runId, live });
    return stream;
  },
}));

vi.mock('../../chat/use-stop.ts', () => ({
  useStop: () => ({ stopping: false, error: null, stop: stopTurn }),
}));

vi.mock('../../chat/commands/command-api.ts', () => ({
  commandOutputKey: (runId: string, id: string) => ['command-output', runId, id],
  fetchCommandOutput: (runId: string, id: string) => fetchOutput(runId, id),
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
  runningCommand: () => Promise.resolve(null),
}));

vi.mock('../terminal-connection.ts', () => ({
  preloadTerminal: () => Promise.resolve(),
  openTerminal: () => ({
    run: () => undefined,
    notice: () => undefined,
    fit: () => undefined,
    focus: () => undefined,
    close: () => undefined,
    dispose: () => undefined,
  }),
}));

const { queryKeys } = await import('../../api/client.ts');
const { TerminalDock } = await import('./TerminalDock.tsx');
const store = await import('./shell-store.ts');

const savedCommand = (change: Partial<CommandRun> = {}): CommandRun => ({
  id: ID,
  runId: RUN,
  command: 'pnpm dev',
  cwd: '/Users/me/widgets',
  live: true,
  startedAt: '2026-10-09T10:00:00.000Z',
  textOffset: null,
  textBefore: null,
  textHeld: null,
  status: 'completed',
  exitCode: 0,
  finishedAt: '2026-10-09T10:00:03.000Z',
  outputChars: 11,
  ...change,
});

function liveCommand(change: Partial<LiveCommand> = {}): LiveCommand {
  return {
    ...savedCommand({ status: 'running', exitCode: null, finishedAt: null }),
    output: 'ready on 5173\n',
    received: 14,
    appended: 14,
    epoch: 0,
    ...change,
  };
}

function detailWith(commands: CommandRun[], runStatus = 'running') {
  return {
    conversation: { id: CHAT },
    runs: [{ id: RUN, provider: 'claude', status: runStatus, parentRunId: null }],
    commands,
  } as unknown as ConversationDetail;
}

function renderDock(detail: ConversationDetail) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.conversation(CHAT), detail);
  const tree = () => (
    <QueryClientProvider client={client}>
      <TerminalDock chatId={CHAT} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { again: () => view.rerender(tree()) };
}

const openTab = () => act(() => store.openCommandTab(CHAT, RUN, ID));
const pane = () => screen.getByRole('group', { name: /run by the agent, read-only$/ });

beforeEach(() => {
  stream.status = 'connecting';
  stream.commands = [];
  streams.length = 0;
  stopTurn.mockClear();
  fetchOutput.mockClear();
});

afterEach(() => {
  for (const tab of [...store.chatOf(CHAT).tabs]) store.closeShell(CHAT, tab.id);
  store.hideShells(CHAT);
  cleanup();
});

describe('mirror tab', () => {
  it('opens the dock on a tab labelled as the agent’s, with the running light and Stop turn', () => {
    stream.status = 'running';
    stream.commands = [liveCommand()];
    renderDock(detailWith([]));
    openTab();

    const tab = screen.getByRole('button', { name: 'Claude · pnpm dev, run by the agent' });
    expect(tab.getAttribute('aria-pressed')).toBe('true');
    expect(tab.getAttribute('title')).toBe('Claude · pnpm dev, run by the agent');
    expect(tab.querySelector('.term-light.open')).toBeTruthy();
    expect(tab.querySelector('.term-tab-agent svg')).toBeTruthy();
    expect(document.activeElement).toBe(pane());
    expect(within(pane()).getByRole('group', { name: 'Command output' }).textContent).toBe(
      'ready on 5173\n',
    );
    expect(within(pane()).getByRole('status').textContent).toBe(
      'This command belongs to the agent’s turn.',
    );
    expect(streams.at(-1)).toEqual({ runId: RUN, live: true });

    fireEvent.click(within(pane()).getByRole('button', { name: 'Stop turn' }));
    expect(stopTurn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Start a new terminal' })).toBeNull();
  });

  it('opens one tab per command and focuses it again on reopen', () => {
    stream.status = 'running';
    stream.commands = [liveCommand()];
    renderDock(detailWith([]));
    openTab();
    act(() => {
      store.newShell(CHAT);
    });
    expect(store.chatOf(CHAT).activeId).not.toBe(store.chatOf(CHAT).tabs[0]!.id);
    act(() => store.hideShells(CHAT));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();

    openTab();
    const chat = store.chatOf(CHAT);
    expect(chat.tabs.filter((tab) => tab.kind === 'command')).toHaveLength(1);
    expect(chat.open).toBe(true);
    expect(chat.activeId).toBe(chat.tabs[0]!.id);
    expect(document.activeElement).toBe(pane());
  });

  it('shows the ended state when the command ends and offers no Stop', () => {
    stream.status = 'running';
    stream.commands = [liveCommand()];
    const view = renderDock(detailWith([]));
    openTab();
    expect(store.chatOf(CHAT).tabs[0]!.status).toBe('open');

    stream.status = 'succeeded';
    stream.commands = [
      liveCommand({ status: 'failed', exitCode: 2, finishedAt: '2026-10-09T10:00:05.000Z' }),
    ];
    view.again();
    expect(store.chatOf(CHAT).tabs[0]!.status).toBe('ended');
    expect(within(pane()).getByRole('status').textContent).toBe('Failed, exit code 2.');
    expect(within(pane()).getByText('exit 2 · 5s')).toBeTruthy();
    expect(within(pane()).queryByRole('button', { name: 'Stop turn' })).toBeNull();
  });

  it('loads the saved tail for a finished command without opening a stream', async () => {
    renderDock(detailWith([savedCommand()], 'succeeded'));
    openTab();
    await waitFor(() =>
      expect(within(pane()).getByRole('group', { name: 'Command output' }).textContent).toBe(
        'saved tail\n',
      ),
    );
    expect(fetchOutput).toHaveBeenCalledWith(RUN, ID);
    expect(streams.every((call) => !call.live)).toBe(true);
    expect(within(pane()).getByRole('status').textContent).toBe('Finished, exit code 0.');
    expect(store.chatOf(CHAT).tabs[0]!.cwd).toBe('/Users/me/widgets');
  });

  it('says output shows at the end for an agent that reports it once', () => {
    stream.status = 'running';
    stream.commands = [liveCommand({ live: false, output: '', received: 0, appended: 0 })];
    renderDock(detailWith([]));
    openTab();
    expect(within(pane()).getByText('Output shows when the command ends.')).toBeTruthy();
    expect(within(pane()).queryByRole('group', { name: 'Command output' })).toBeNull();
  });

  it('closes with its tab and leaves other tabs alone', async () => {
    stream.status = 'running';
    stream.commands = [liveCommand()];
    renderDock(detailWith([]));
    act(() => {
      store.newShell(CHAT);
    });
    openTab();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close Claude · pnpm dev' }));
      await Promise.resolve();
    });
    const chat = store.chatOf(CHAT);
    expect(chat.tabs.map((tab) => tab.kind)).toEqual(['shell']);
    expect(chat.open).toBe(true);
    expect(screen.queryByRole('group', { name: /run by the agent/ })).toBeNull();
  });
});
