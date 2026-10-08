// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatSettings } from '@spark-outpost/contracts';
const fake = vi.hoisted(() => ({ create: vi.fn(), settings: vi.fn(), launch: vi.fn() }));
vi.mock('../api/client.ts', () => ({
  api: { updateChatSettings: fake.settings },
  request: fake.create,
  forgetDraft: vi.fn(),
  queryKeys: {
    conversation: (id: string) => ['conversations', id],
    conversations: ['conversations'],
  },
  capabilitiesQuery: () => ({
    queryKey: ['capabilities'],
    queryFn: async () => ({
      defaultMode: 'read-only',
      modes: [
        { id: 'read-only', label: 'Read-only' },
        { id: 'ask-every-action', label: 'Ask every time' },
        { id: 'agent', label: 'Approve for me' },
      ],
    }),
  }),
}));
vi.mock('../api/projects.ts', () => ({
  projectKeys: { all: ['projects'] },
  projectsApi: { list: async () => [] },
}));
vi.mock('./terminal-api.ts', () => ({ nativeTerminalApi: { launch: fake.launch } }));
const { NewTerminalSession } = await import('./NewTerminalSession.tsx');
const SETTLE = { timeout: 20_000 };
vi.setConfig({ testTimeout: 60_000 });
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  fake.create.mockResolvedValue({});
  fake.settings.mockResolvedValue({});
  fake.launch.mockResolvedValue({});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
it('requires an explicit supported choice instead of weakening Ask every time', async () => {
  render(
    <QueryClientProvider client={client}>
      <NewTerminalSession
        conversationId="chat"
        choice={{ sessionType: 'terminal', terminalProvider: 'codex' }}
        connected={true}
        projectIds={[]}
        settings={{ provider: 'codex', agentMode: 'ask-every-action' } as ChatSettings}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Agent mode' }, SETTLE);
  fireEvent.change(screen.getByRole('textbox', { name: 'What would you like to work on?' }), {
    target: { value: 'Inspect the code.' },
  });
  expect(
    (screen.getByRole('button', { name: 'Start terminal' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(fake.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Agent mode' }));
  expect(screen.queryByRole('menuitemradio', { name: 'Ask every time' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Read-only' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start terminal' }));
  await waitFor(() => expect(fake.launch).toHaveBeenCalled(), SETTLE);
  expect(fake.settings).toHaveBeenCalledWith('chat', { provider: 'codex', agentMode: 'read-only' });
});

it('starts a signed-in native CLI without requiring an ACP connection', async () => {
  render(
    <QueryClientProvider client={client}>
      <NewTerminalSession
        conversationId="native-only"
        choice={{ sessionType: 'terminal', terminalProvider: 'codex' }}
        projectIds={[]}
        settings={null}
        connected={false}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'What would you like to work on?' }), {
    target: { value: 'Inspect the code.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start terminal' }));
  await waitFor(
    () =>
      expect(fake.launch).toHaveBeenCalledWith(
        'native-only',
        expect.objectContaining({ provider: 'codex', prompt: 'Inspect the code.' }),
      ),
    SETTLE,
  );
  expect(fake.settings).not.toHaveBeenCalled();
});

it('shows the existing secret warning before sending a terminal prompt', async () => {
  render(
    <QueryClientProvider client={client}>
      <NewTerminalSession
        conversationId="secret-warning"
        choice={{ sessionType: 'terminal', terminalProvider: 'claude' }}
        projectIds={[]}
        settings={null}
        connected={false}
      />
    </QueryClientProvider>,
  );
  const prompt = 'Inspect ghp_abcdefghijklmnopqrstuvwxyz0123';
  fireEvent.change(screen.getByRole('textbox', { name: 'What would you like to work on?' }), {
    target: { value: prompt },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start terminal' }));
  expect(screen.getByRole('alert').textContent).toContain('GitHub token');
  expect(fake.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));
  await waitFor(
    () =>
      expect(fake.launch).toHaveBeenCalledWith(
        'secret-warning',
        expect.objectContaining({ prompt }),
      ),
    SETTLE,
  );
});

it('retries a failed launch with the same message and uses a new one after the prompt is edited', async () => {
  fake.launch.mockRejectedValue(new Error('The terminal could not start. Try again.'));
  render(
    <QueryClientProvider client={client}>
      <NewTerminalSession
        conversationId="native-retry"
        choice={{ sessionType: 'terminal', terminalProvider: 'codex' }}
        projectIds={[]}
        settings={null}
        connected={false}
      />
    </QueryClientProvider>,
  );
  const prompt = screen.getByRole('textbox', { name: 'What would you like to work on?' });
  const start = screen.getByRole('button', { name: 'Start terminal' });
  const sentIds = () => fake.launch.mock.calls.map((call) => call[1].messageId as string);
  fireEvent.change(prompt, { target: { value: 'Inspect the code.' } });
  fireEvent.click(start);
  await screen.findByText('The terminal could not start. Try again.', undefined, SETTLE);
  fireEvent.click(start);
  await waitFor(() => expect(fake.launch).toHaveBeenCalledTimes(2), SETTLE);
  expect(sentIds()[1]).toBe(sentIds()[0]);
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false), SETTLE);
  fireEvent.change(prompt, { target: { value: 'Inspect the tests instead.' } });
  fireEvent.click(start);
  await waitFor(() => expect(fake.launch).toHaveBeenCalledTimes(3), SETTLE);
  expect(sentIds()[2]).not.toBe(sentIds()[0]);
});
