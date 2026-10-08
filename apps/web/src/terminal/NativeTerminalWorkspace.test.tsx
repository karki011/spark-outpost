// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationDetail,
  ConversationSummary,
  NativeTerminalSession,
} from '@spark-outpost/contracts';
import type { TerminalHandlers } from './terminal-connection.ts';

const fake = vi.hoisted(() => ({
  get: vi.fn(),
  launch: vi.fn(),
  attach: vi.fn(),
  stop: vi.fn(),
  disposed: vi.fn(),
  handlers: [] as TerminalHandlers<{ id: string; token: string }>[],
}));
vi.mock('./terminal-api.ts', () => ({
  nativeTerminalApi: { get: fake.get, launch: fake.launch, attach: fake.attach, stop: fake.stop },
  deleteTerminalSession: fake.stop,
}));
vi.mock('./TerminalCompanion.tsx', () => ({
  TerminalCompanion: () => <span data-testid="companion" />,
}));
vi.mock('../phone/use-remote-client.ts', () => ({ useRemoteClient: () => ({ remote: false }) }));
vi.mock('./terminal-connection.ts', () => ({
  openTerminal: (
    start: () => Promise<{ id: string; token: string }>,
    _element: HTMLElement,
    handlers: TerminalHandlers<{ id: string; token: string }>,
  ) => {
    fake.handlers.push(handlers);
    void start().then(handlers.onOpen, (error: Error) => handlers.onError(error.message));
    return { dispose: fake.disposed };
  },
}));
const { NativeTerminalWorkspace } = await import('./NativeTerminalWorkspace.tsx');
let client: QueryClient;
const native: NativeTerminalSession = {
  id: 'terminal-session',
  conversationId: 'chat',
  provider: 'codex',
  state: 'working',
  cwd: '/tmp/project',
  label: 'Codex',
  updatedAt: '2026-10-08T10:00:00Z',
  resumeAvailable: false,
  runId: null,
  observation: 'hooks',
  reason: null,
};
const chat = { id: 'chat', terminal: native, sessionType: 'terminal' } as ConversationSummary;
const detail = { approvals: [] } as unknown as ConversationDetail;
function mount(summary: ConversationSummary = chat) {
  return render(
    <QueryClientProvider client={client}>
      <NativeTerminalWorkspace chat={summary} detail={detail} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.handlers.length = 0;
  fake.get.mockResolvedValue(native);
  fake.attach.mockResolvedValue({ id: native.id, token: 'attach-token' });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('native terminal lifecycle controls', () => {
  it('hides the view without stopping the process and reattaches on reopening', async () => {
    mount();
    await waitFor(() => expect(fake.attach).toHaveBeenCalledWith(native.id));
    expect(fake.handlers[0]?.preserveSession).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide view' }));
    expect(fake.disposed).toHaveBeenCalledTimes(1);
    expect(fake.stop).not.toHaveBeenCalled();
    expect(screen.getByText('The terminal view is hidden. Your agent keeps running.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }));
    await waitFor(() => expect(fake.attach).toHaveBeenCalledTimes(2));
    expect(fake.launch).not.toHaveBeenCalled();
  });
  it('does not restart an interrupted process until explicit Resume', async () => {
    fake.get.mockResolvedValue({ ...native, state: 'interrupted', resumeAvailable: true });
    fake.launch.mockImplementation(async () => {
      fake.get.mockResolvedValue(native);
      return { session: native, connection: { id: native.id, token: 'resume-token' } };
    });
    mount();
    const resume = await screen.findByRole('button', { name: 'Resume session' });
    expect(fake.launch).not.toHaveBeenCalled();
    fireEvent.click(resume);
    await waitFor(() => expect(fake.launch).toHaveBeenCalledWith('chat', { resume: true }));
  });
  it('keeps the last terminal output on screen with a notice after the session ends', async () => {
    mount();
    await waitFor(() => expect(fake.attach).toHaveBeenCalledWith(native.id));
    fake.get.mockResolvedValue({ ...native, state: 'exited', reason: 'Native agent exited (0).' });
    fake.handlers[0]!.onEnded('exited');
    await screen.findByText('This terminal session has stopped. Its last output is shown below.');
    expect(screen.getByLabelText('Interactive agent terminal')).toBeTruthy();
    expect(fake.disposed).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop session' })).toBeNull();
  });
  it('keeps a live terminal mounted when a status check fails', async () => {
    mount();
    await waitFor(() => expect(fake.attach).toHaveBeenCalledWith(native.id));
    fake.get.mockRejectedValue(new Error('Status is unavailable.'));
    await client.refetchQueries({ queryKey: ['native-terminal', 'chat'] });
    await screen.findByText('Status is unavailable.');
    expect(screen.getByLabelText('Interactive agent terminal')).toBeTruthy();
    expect(fake.disposed).not.toHaveBeenCalled();
  });
  it('offers to start again when the launch failed before any native session existed', async () => {
    fake.get.mockResolvedValue({ ...native, state: 'error', reason: 'Close a terminal first.' });
    fake.launch.mockImplementation(async () => {
      fake.get.mockResolvedValue(native);
      return { session: native, connection: { id: native.id, token: 'fresh-token' } };
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(fake.launch).toHaveBeenCalledWith('chat', {}));
    await waitFor(() => expect(fake.attach).toHaveBeenCalledWith(native.id));
  });
  it('offers to start again, keeping the last output, when the agent exited with nothing to resume', async () => {
    mount();
    await waitFor(() => expect(fake.attach).toHaveBeenCalledWith(native.id));
    fake.get.mockResolvedValue({ ...native, state: 'exited', reason: 'Native agent exited (0).' });
    fake.handlers[0]!.onEnded('exited');
    const again = await screen.findByRole('button', { name: 'Start again' });
    expect(screen.getByLabelText('Interactive agent terminal')).toBeTruthy();
    expect(fake.disposed).not.toHaveBeenCalled();
    expect(fake.launch).not.toHaveBeenCalled();
    fake.launch.mockImplementation(async () => {
      fake.get.mockResolvedValue(native);
      return { session: native, connection: { id: native.id, token: 'fresh-token' } };
    });
    fireEvent.click(again);
    await waitFor(() => expect(fake.launch).toHaveBeenCalledWith('chat', {}));
    await waitFor(() => expect(fake.attach).toHaveBeenCalledTimes(2));
  });
  it('offers to resume an exited session that has a provider session', async () => {
    fake.get.mockResolvedValue({ ...native, state: 'exited', resumeAvailable: true });
    mount();
    await screen.findByRole('button', { name: 'Resume session' });
    expect(screen.queryByRole('button', { name: 'Start again' })).toBeNull();
  });
  it('offers no restart for a session the user stopped before it had anything to resume', async () => {
    fake.get.mockResolvedValue({ ...native, state: 'exited', reason: 'Stopped by the user.' });
    mount({ ...chat, latestRun: { status: 'cancelled' } } as ConversationSummary);
    await screen.findByText('This terminal session has stopped.');
    expect(screen.queryByRole('button', { name: 'Start again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume session' })).toBeNull();
  });
});
