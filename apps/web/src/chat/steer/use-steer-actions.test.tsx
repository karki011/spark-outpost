// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemberMessage } from '@spark-outpost/contracts';
import { takeDraft, usePendingDraft } from '../composer/pending-draft.ts';
import { queueApi } from '../queue/queue-api.ts';
import { useSteerActions } from './use-steer-actions.ts';

const CHAT = '00000000-0000-4000-8000-000000000001';

const message = (id: string, body: string) => ({ id, body }) as unknown as MemberMessage;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  takeDraft(CHAT);
});

describe('Edit on missed messages', () => {
  it('puts the text of every message it removed back in the composer when a later remove fails', async () => {
    vi.spyOn(queueApi, 'dropSteer').mockImplementation(async (_chat, id) => {
      if (id === 'b') throw new Error('Network error');
      return {} as Awaited<ReturnType<typeof queueApi.dropSteer>>;
    });
    const { result } = renderHook(
      () => ({ actions: useSteerActions(CHAT), draft: usePendingDraft(CHAT) }),
      { wrapper },
    );
    act(() =>
      result.current.actions.edit([
        message('a', 'First'),
        message('b', 'Second'),
        message('c', 'Third'),
      ]),
    );
    await waitFor(() => expect(result.current.actions.error).toBe('Network error'));
    expect(result.current.draft).toBe('First');
    expect(queueApi.dropSteer).toHaveBeenCalledTimes(2);
  });

  it('puts all of their text in the composer when every remove succeeds', async () => {
    vi.spyOn(queueApi, 'dropSteer').mockResolvedValue(
      {} as Awaited<ReturnType<typeof queueApi.dropSteer>>,
    );
    const { result } = renderHook(
      () => ({ actions: useSteerActions(CHAT), draft: usePendingDraft(CHAT) }),
      { wrapper },
    );
    act(() => result.current.actions.edit([message('a', 'First'), message('b', 'Second')]));
    await waitFor(() => expect(result.current.draft).toBe('First\n\nSecond'));
  });
});
