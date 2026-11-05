// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { AnnotationInput, Attachment } from '@spark-outpost/contracts';
import { queueApi } from './queue-api.ts';
import { useChatQueue } from './use-chat-queue.ts';

const files = [{ id: 'file-a' }] as Attachment[];
const annotations = [{ id: 'quote-a' }] as AnnotationInput[];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function chat() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useChatQueue('chat-a', []), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

it('queues an image-only message with its attachment and annotation references', async () => {
  const add = vi.spyOn(queueApi, 'add').mockResolvedValue({ queue: [] });
  const hook = chat();
  await act(async () => hook.result.current.add('', files, annotations));
  expect(add).toHaveBeenCalledWith(
    'chat-a',
    expect.any(String),
    '',
    undefined,
    ['file-a'],
    annotations,
  );
});

it('sends attachments and annotations to the running turn', async () => {
  const send = vi.spyOn(queueApi, 'sendFirst').mockResolvedValue({ queue: [] });
  const hook = chat();
  await act(async () => hook.result.current.sendFirst('Look at this', files, annotations));
  expect(send).toHaveBeenCalledWith(
    'chat-a',
    expect.any(String),
    'Look at this',
    ['file-a'],
    annotations,
  );
});

it('rejects a failed queue delivery so the composer can retain its draft and files', async () => {
  vi.spyOn(queueApi, 'add').mockRejectedValue(new Error('Disconnected'));
  const hook = chat();
  await act(async () => {
    await expect(hook.result.current.add('', files, annotations)).rejects.toThrow('Disconnected');
  });
});
