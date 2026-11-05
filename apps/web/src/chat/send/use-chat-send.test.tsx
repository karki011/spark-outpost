// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { SendMessageResponse } from '@spark-outpost/contracts';
import { api } from '../../api/client.ts';
import { useChatSend } from './use-chat-send.ts';

const accepted = {} as SendMessageResponse;
const content = { content: 'Check the cache', attachments: [] };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function chat(
  onSent: () => Promise<unknown>,
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  const hook = renderHook(({ saved }) => useChatSend('chat-a', saved, onSent), {
    initialProps: { saved: new Set<string>() },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return hook;
}

it('keeps accepted text visible without treating a slow refresh as an unaccepted send', async () => {
  vi.spyOn(api, 'sendMessage').mockResolvedValue(accepted);
  let resolve = () => {};
  const refresh = new Promise<void>((done) => {
    resolve = done;
  });
  const hook = chat(() => refresh);
  act(() => hook.result.current.send(content));
  try {
    await waitFor(() => expect(hook.result.current.pending[0]?.phase).toBe('accepted'));
    expect(hook.result.current.sending).toBe(false);
    const message = hook.result.current.pending[0]!.message;
    act(() => hook.result.current.retry(message));
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    hook.rerender({ saved: new Set([message.id]) });
    await waitFor(() => expect(hook.result.current.pending).toEqual([]));
  } finally {
    await act(async () => resolve());
  }
});

it('does not turn an accepted message into a failed send when refreshing fails', async () => {
  vi.spyOn(api, 'sendMessage').mockResolvedValue(accepted);
  const hook = chat(async () => {
    throw new Error('Refresh failed');
  });
  act(() => hook.result.current.send(content));
  await waitFor(() => expect(hook.result.current.pending[0]?.phase).toBe('accepted'));
  expect(hook.result.current.sending).toBe(false);
  act(() => hook.result.current.send({ ...content, content: 'One more detail' }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(2));
});

it('retries an unaccepted message with the same id and content', async () => {
  vi.spyOn(api, 'sendMessage')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue(accepted);
  const hook = chat(async () => undefined);
  act(() => hook.result.current.send(content));
  await waitFor(() => expect(hook.result.current.pending[0]?.phase).toBe('failed'));
  const message = hook.result.current.pending[0]!.message;
  act(() => hook.result.current.retry(message));
  await waitFor(() => expect(hook.result.current.pending[0]?.phase).toBe('accepted'));
  expect(api.sendMessage).toHaveBeenNthCalledWith(
    2,
    'chat-a',
    message.id,
    message.content,
    [],
    undefined,
  );
});

it('allows the next message when a retry succeeds before the original request settles', async () => {
  let resolve = (_response: SendMessageResponse) => {};
  const first = new Promise<SendMessageResponse>((done) => {
    resolve = done;
  });
  vi.spyOn(api, 'sendMessage').mockReturnValueOnce(first).mockResolvedValue(accepted);
  const hook = chat(async () => undefined);
  act(() => hook.result.current.send(content));
  await waitFor(() => expect(hook.result.current.pending).toHaveLength(1));
  const message = hook.result.current.pending[0]!.message;
  act(() => hook.result.current.retry(message));
  await waitFor(() => expect(hook.result.current.pending[0]?.phase).toBe('accepted'));
  act(() => hook.result.current.send({ ...content, content: 'Next message' }));
  await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(3));
  await act(async () => resolve(accepted));
  expect(api.sendMessage).toHaveBeenNthCalledWith(
    2,
    'chat-a',
    message.id,
    message.content,
    [],
    undefined,
  );
});

it('retains acceptance past cache collection and releases all attempts once the chat has them', async () => {
  let resolve = (_response: SendMessageResponse) => {};
  const first = new Promise<SendMessageResponse>((done) => {
    resolve = done;
  });
  vi.spyOn(api, 'sendMessage').mockReturnValueOnce(first).mockResolvedValue(accepted);
  const client = new QueryClient();
  const hook = chat(async () => undefined, client);
  act(() => hook.result.current.send(content));
  await waitFor(() => expect(hook.result.current.pending).toHaveLength(1));
  const message = hook.result.current.pending[0]!.message;
  act(() => hook.result.current.retry(message));
  await waitFor(() => expect(hook.result.current.pending[0]?.phase).toBe('accepted'));
  vi.useFakeTimers();
  act(() => hook.result.current.send({ ...content, content: 'Next message' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  hook.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6 * 60_000);
  });
  const restored = chat(async () => undefined, client);
  expect(restored.result.current.pending.map((send) => send.phase)).toEqual([
    'accepted',
    'accepted',
  ]);
  expect(restored.result.current.sending).toBe(false);
  act(() => restored.result.current.retry(message));
  expect(api.sendMessage).toHaveBeenCalledTimes(3);
  const saved = new Set(restored.result.current.pending.map((send) => send.message.id));
  restored.rerender({ saved });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  await act(async () => resolve(accepted));
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});
