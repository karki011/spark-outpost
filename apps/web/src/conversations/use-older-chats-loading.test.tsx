// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CHAT_LIST_PAGE, type ConversationSummary } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.ts';
import { OlderChatsMore } from './OlderChatsMore.tsx';
import { useOlderChats } from './use-older-chats.ts';

const chat = (id: string) => ({ id, title: id }) as ConversationSummary;
const headOf = (first: number) =>
  Array.from({ length: CHAT_LIST_PAGE }, (_, index) => chat(`c${first + index}`));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const start = (head: ConversationSummary[]) =>
  renderHook(({ data }) => useOlderChats(data), { wrapper, initialProps: { data: head } });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loading older chats', () => {
  it('asks again from the new end of the list when a new chat moves it', async () => {
    const list = vi
      .spyOn(api, 'listConversationsAfter')
      .mockImplementation(async (cursor) =>
        cursor === `c${CHAT_LIST_PAGE - 1}`
          ? [chat('older')]
          : [chat(`c${CHAT_LIST_PAGE - 1}`), chat('older')],
      );
    const { result, rerender } = start(headOf(0));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.chats.at(-1)?.id).toBe('older'));

    rerender({ data: [chat('new'), ...headOf(0).slice(0, -1)] });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(`c${CHAT_LIST_PAGE - 2}`));
    await waitFor(() =>
      expect(result.current.chats.map((item) => item.id)).toContain(`c${CHAT_LIST_PAGE - 1}`),
    );
  });

  it('keeps offering older chats after a removal drops the list under a page', () => {
    const { result, rerender } = start(headOf(0));
    expect(result.current.hasMore).toBe(true);
    rerender({ data: headOf(0).slice(1) });
    expect(result.current.hasMore).toBe(true);
  });

  it('offers nothing when the list never filled a page', () => {
    expect(start(headOf(0).slice(1)).result.current.hasMore).toBe(false);
  });

  it('can try a failed first page again', async () => {
    const list = vi
      .spyOn(api, 'listConversationsAfter')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue([chat('older')]);
    const { result } = start(headOf(0));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.chats.at(-1)?.id).toBe('older'));
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.failed).toBe(false);
  });

  it('reports a later page that failed and tries it again when asked', async () => {
    const full = Array.from({ length: CHAT_LIST_PAGE }, (_, index) => chat(`o${index}`));
    const list = vi
      .spyOn(api, 'listConversationsAfter')
      .mockResolvedValueOnce(full)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue([chat('last')]);
    const { result } = start(headOf(0));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.chats).toHaveLength(CHAT_LIST_PAGE * 2));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.chats.at(-1)?.id).toBe('last'));
    expect(list).toHaveBeenCalledTimes(3);
  });
});

describe('OlderChatsMore', () => {
  function watchIntersections() {
    const observe = vi.fn();
    class Observer {
      observe = observe;
      disconnect = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', Observer);
    return observe;
  }

  it('loads on its own while nothing has failed', () => {
    const observe = watchIntersections();
    render(<OlderChatsMore loading={false} failed={false} onMore={vi.fn()} />);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it('waits for a click after a failure', () => {
    const observe = watchIntersections();
    const onMore = vi.fn();
    render(<OlderChatsMore loading={false} failed onMore={onMore} />);
    expect(observe).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t load older chats');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});
