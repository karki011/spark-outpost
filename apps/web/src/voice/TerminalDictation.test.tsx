// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { VoiceEvent } from '@spark-outpost/contracts';
import { TerminalDictation } from './TerminalDictation.tsx';

const fake = vi.hoisted(() => ({
  listen: vi.fn(async () => ({ ok: true, id: 'listen' })),
  stop: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  message: vi.fn(async () => undefined),
  event: null as ((event: VoiceEvent) => void) | null,
}));
vi.mock('./speech-bridge.ts', () => ({
  desktopSpeech: () => fake,
  useSpeechStatus: () => ({ settings: { enabled: true } }),
  useSpeechEvents: (callback: (event: VoiceEvent) => void) => {
    fake.event = callback;
  },
}));
vi.mock('../terminal/terminal-api.ts', () => ({ terminalRemoteApi: { message: fake.message } }));
afterEach(cleanup);

it('returns focus from Stop dictating to the terminal message without sending automatically', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TerminalDictation chatId="terminal" agentName="Claude" />
    </QueryClientProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dictate' })));
  const stop = screen.getByRole('button', { name: 'Stop dictating' });
  stop.focus();
  fireEvent.click(stop);
  act(() =>
    fake.event?.({
      kind: 'final',
      id: 'listen',
      text: 'Please inspect the build',
      reason: 'stopped',
    }),
  );
  const input = screen.getByRole('textbox', { name: 'Dictated message for Claude' });
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe('Please inspect the build');
  expect(fake.message).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('form', { name: 'Dictated message' }));
  await waitFor(() =>
    expect(fake.message).toHaveBeenCalledWith('terminal', 'Please inspect the build'),
  );
  client.clear();
});

it('previews live words in the terminal message without sending them', async () => {
  fake.message.mockClear();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TerminalDictation chatId="terminal" agentName="Claude" />
    </QueryClientProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dictate' })));
  act(() => fake.event?.({ kind: 'partial', id: 'listen', text: 'Please' }));
  act(() => fake.event?.({ kind: 'partial', id: 'listen', text: 'Please inspect the' }));
  const input = screen.getByRole('textbox', { name: 'Dictated message for Claude' });
  expect((input as HTMLInputElement).value).toBe('Please inspect the');
  expect(
    (screen.getByRole('button', { name: 'Send to Claude' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.submit(screen.getByRole('form', { name: 'Dictated message' }));
  expect(fake.message).not.toHaveBeenCalled();
  client.clear();
});
