// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateShellResponse, TerminalEndReason } from '@spark-outpost/contracts';
import type { TerminalHandlers } from '../terminal-connection.ts';
import { clampDockHeight, DOCK_DEFAULT_HEIGHT, readDockHeight } from './dock-height.ts';

interface FakeConnection {
  chatId: string | null;
  handlers: TerminalHandlers<CreateShellResponse>;
  notices: string[];
  disposed: boolean;
  focused: number;
}

const opened: FakeConnection[] = [];
const running = new Map<string, string>();

vi.mock('../terminal-api.ts', () => ({
  createShell: (chatId: string | null) => Promise.resolve({ chatId }),
  runningCommand: (sessionId: string) => Promise.resolve(running.get(sessionId) ?? null),
}));

vi.mock('../terminal-connection.ts', () => ({
  preloadTerminal: () => Promise.resolve(),
  openTerminal: (
    start: () => Promise<{ chatId: string | null }>,
    _element: HTMLElement,
    handlers: TerminalHandlers<CreateShellResponse>,
  ) => {
    const connection: FakeConnection = {
      chatId: null,
      handlers,
      notices: [],
      disposed: false,
      focused: 0,
    };
    void start().then((ticket) => {
      connection.chatId = ticket.chatId;
    });
    opened.push(connection);
    return {
      run: () => undefined,
      notice: (text: string) => connection.notices.push(text),
      fit: () => undefined,
      focus: () => {
        connection.focused += 1;
      },
      close: () => undefined,
      dispose: () => {
        connection.disposed = true;
      },
    };
  },
}));

const { ChatHeaderMenu } = await import('../../audit/ChatHeaderMenu.tsx');
const { useTerminalPane } = await import('./terminal-pane.tsx');
const { TerminalDock, tabNames } = await import('./TerminalDock.tsx');
const store = await import('./shell-store.ts');

function started(connection: FakeConnection, change: Partial<CreateShellResponse> = {}) {
  act(() =>
    connection.handlers.onOpen({
      id: `session-${opened.indexOf(connection)}`,
      token: 't',
      cwd: '/Users/me/widgets',
      label: 'my files · widgets',
      kind: 'project',
      note: null,
      ...change,
    }),
  );
}

function end(connection: FakeConnection, reason: TerminalEndReason) {
  act(() => connection.handlers.onEnded(reason));
}

function Chat({ id }: { id: string }) {
  const menuButton = useRef<HTMLButtonElement>(null);
  const pane = useTerminalPane(id, menuButton, true);
  return (
    <>
      <ChatHeaderMenu chatId={id} panes={pane ? [pane] : []} buttonRef={menuButton} />
      <TerminalDock chatId={id} />
    </>
  );
}

const menuButton = () => screen.getByRole('button', { name: /^Chat actions\./ });
const terminalItem = () => {
  if (!screen.queryByRole('menu')) fireEvent.click(menuButton());
  return screen.getByRole('menuitemcheckbox', { name: /^Terminal/ });
};
const toggleTerminal = () => fireEvent.click(terminalItem());
const dock = () => screen.queryByRole('region', { name: 'Terminal' });
const closeTab = (name: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: `Close ${name}` }));
    await Promise.resolve();
  });
const toggleKey = () =>
  fireEvent.keyDown(document.body, { key: '`', code: 'Backquote', ctrlKey: true });

beforeEach(() => {
  opened.length = 0;
  running.clear();
});

afterEach(() => {
  for (const chat of ['a', 'b']) {
    for (const tab of [...store.chatOf(chat).tabs]) store.closeShell(chat, tab.id);
  }
  cleanup();
});

describe('chat terminal dock', () => {
  it('opens a shell for the chat and labels its tab with the folder', async () => {
    render(<Chat id="a" />);
    expect(terminalItem().getAttribute('aria-checked')).toBe('false');
    expect(terminalItem().getAttribute('aria-keyshortcuts')).toBe('Control+`');

    toggleTerminal();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menuButton());
    expect(terminalItem().getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dock()).not.toBeNull();
    expect(screen.getByText('Opening terminal')).toBeTruthy();
    await Promise.resolve();
    expect(opened[0]?.chatId).toBe('a');

    started(opened[0]!, { note: 'This chat’s worktree was removed.' });
    expect(screen.getByRole('button', { name: 'my files · widgets' })).toBeTruthy();
    expect(opened[0]!.notices).toEqual(['This chat’s worktree was removed.']);
    expect(opened[0]!.focused).toBe(1);
  });

  it('hides without closing shells and shows them again with Ctrl+`', () => {
    render(<Chat id="a" />);
    toggleKey();
    started(opened[0]!);
    toggleKey();
    expect(dock()).toBeNull();
    expect(opened[0]!.disposed).toBe(false);
    expect(menuButton().getAttribute('aria-label')).toBe('Chat actions. Terminal running.');
    expect(menuButton().querySelector('.head-menu-dot')).not.toBeNull();
    expect(terminalItem().textContent).toContain('Running');
    fireEvent.keyDown(window, { key: 'Escape' });

    toggleKey();
    expect(dock()).not.toBeNull();
    expect(opened).toHaveLength(1);
    expect(menuButton().getAttribute('aria-label')).toBe('Chat actions.');
    expect(menuButton().querySelector('.head-menu-dot')).toBeNull();
  });

  it('adds and closes tabs, closing the shell with its tab', async () => {
    render(<Chat id="a" />);
    toggleTerminal();
    started(opened[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    started(opened[1]!);
    const second = screen.getByRole('button', { name: 'my files · widgets (2)' });
    expect(second.getAttribute('aria-pressed')).toBe('true');

    await closeTab('my files · widgets (2)');
    expect(opened[1]!.disposed).toBe(true);
    expect(opened[0]!.disposed).toBe(false);
    expect(
      screen.getByRole('button', { name: 'my files · widgets' }).getAttribute('aria-pressed'),
    ).toBe('true');

    await closeTab('my files · widgets');
    expect(dock()).toBeNull();
  });

  it('asks before stopping a busy shell, and keeps it running on request', async () => {
    render(<Chat id="a" />);
    toggleTerminal();
    started(opened[0]!);
    running.set('session-0', 'pnpm dev');

    await closeTab('my files · widgets');
    const confirm = screen.getByRole('group', { name: 'Stop pnpm dev?' });
    expect(confirm.textContent).toContain('still running in my files · widgets');
    expect(document.activeElement?.textContent).toBe('Hold to stop');
    expect(screen.getByText(/pnpm dev is still running/).getAttribute('aria-live')).toBe('polite');
    expect(opened[0]!.disposed).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(screen.queryByRole('group', { name: 'Stop pnpm dev?' })).toBeNull();
    expect(opened[0]!.disposed).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Close my files · widgets' }),
    );

    await closeTab('my files · widgets');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Stop pnpm dev?' })).toBeNull();
    expect(opened[0]!.disposed).toBe(false);
  });

  it('stops a busy shell after a full hold', async () => {
    render(<Chat id="a" />);
    toggleTerminal();
    started(opened[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    started(opened[1]!);
    running.set('session-0', 'sleep 100');

    await closeTab('my files · widgets');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const hold = screen.getByRole('button', { name: 'Hold to stop' });
    fireEvent.keyDown(hold, { key: ' ' });
    act(() => vi.advanceTimersByTime(1000));
    expect(opened[0]!.disposed).toBe(false);
    act(() => vi.advanceTimersByTime(500));
    vi.useRealTimers();

    expect(opened[0]!.disposed).toBe(true);
    expect(opened[1]!.disposed).toBe(false);
    expect(screen.queryByRole('group', { name: 'Stop sleep 100?' })).toBeNull();
    expect(screen.getByText('Stopped sleep 100.').getAttribute('aria-live')).toBe('polite');
    expect(opened[1]!.focused).toBeGreaterThan(0);
  });

  it('keeps each chat’s terminals to itself', () => {
    const view = render(<Chat id="a" />);
    toggleTerminal();
    started(opened[0]!);
    view.rerender(<Chat key="b" id="b" />);
    expect(dock()).toBeNull();
    toggleTerminal();
    started(opened[1]!, { label: '~', cwd: '/Users/me', kind: 'home' });
    expect(screen.queryByRole('button', { name: 'my files · widgets' })).toBeNull();
    expect(screen.getByRole('button', { name: '~' })).toBeTruthy();
  });

  it('says why a shell ended and drops tabs of a deleted chat', () => {
    render(<Chat id="a" />);
    toggleTerminal();
    started(opened[0]!);
    end(opened[0]!, 'folder_removed');
    expect(screen.getByRole('status').textContent).toContain(
      'This folder was removed, so its terminal closed.',
    );
    expect(opened[0]!.notices).toContain('This folder was removed, so its terminal closed.');

    fireEvent.click(screen.getByRole('button', { name: 'Start a new terminal' }));
    expect(opened[0]!.disposed).toBe(true);
    started(opened[1]!);
    end(opened[1]!, 'chat_removed');
    expect(dock()).toBeNull();
    expect(opened[1]!.disposed).toBe(true);
  });
});

describe('dock helpers', () => {
  it('numbers tabs that share a folder', () => {
    const tab = (id: string, label: string | null) =>
      ({ id, label }) as Parameters<typeof tabNames>[0][number];
    const names = tabNames([
      tab('1', '~'),
      tab('2', 'my files · w'),
      tab('3', '~'),
      tab('4', null),
    ]);
    expect([...names.values()]).toEqual(['~', 'my files · w', '~ (2)', 'Terminal']);
  });

  it('keeps the height in range and survives storage that throws', () => {
    expect(clampDockHeight(20)).toBe(140);
    expect(clampDockHeight(5000)).toBe(900);
    expect(clampDockHeight(600, 400)).toBe(400);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readDockHeight()).toBe(DOCK_DEFAULT_HEIGHT);
    getItem.mockReturnValue('333');
    expect(readDockHeight()).toBe(333);
    getItem.mockRestore();
  });
});
