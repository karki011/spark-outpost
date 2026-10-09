// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrRefreshResult, PrWatchList } from '@spark-outpost/contracts';
import { watch } from './watch-fixture.ts';

const api = vi.hoisted(() => ({ refreshOne: vi.fn() }));
vi.mock('./pr-follow-up-api.ts', () => ({
  prFollowUpApi: { refreshOne: api.refreshOne },
  prWatchesKey: (conversationId: string) => ['conversation', conversationId, 'pull-requests'],
}));
const { RefreshPullButton } = await import('./RefreshPullButton.tsx');
const { usePullRefresh } = await import('./use-pull-refresh.ts');

const closed = watch({ prState: 'closed', phase: 'done' });
const KEY = ['conversation', closed.conversationId, 'pull-requests'];
let client: QueryClient;

function Row() {
  const refresh = usePullRefresh(closed);
  return (
    <>
      <RefreshPullButton number={closed.number} refresh={refresh} />
      <p role="status">{refresh.problem}</p>
    </>
  );
}

function mount() {
  render(
    <QueryClientProvider client={client}>
      <Row />
    </QueryClientProvider>,
  );
  return screen.getByRole('button', { name: 'Refresh pull request #7' });
}

function answerLater() {
  let answer: (result: PrRefreshResult) => void = () => undefined;
  api.refreshOne.mockReturnValueOnce(
    new Promise<PrRefreshResult>((resolve) => {
      answer = resolve;
    }),
  );
  return (result: PrRefreshResult) => answer(result);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  api.refreshOne.mockReset();
});

afterEach(cleanup);

describe('the refresh button of a pull request', () => {
  it('is busy while GitHub is read, then stores the state that came back', async () => {
    const answer = answerLater();
    const button = mount();
    expect(button.getAttribute('aria-busy')).toBe('false');

    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(button);
    expect(api.refreshOne).toHaveBeenCalledTimes(1);
    expect(api.refreshOne).toHaveBeenCalledWith(closed.conversationId, closed.id);

    answer({ watches: [{ ...closed, prState: 'open', phase: 'watching' }], problem: null });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
    expect(client.getQueryData<PrWatchList>(KEY)?.watches[0]?.prState).toBe('open');
    expect(screen.getByRole('status').textContent).toBe('');
    expect(document.activeElement === button || document.activeElement === document.body).toBe(
      true,
    );
  });

  it('says why in one plain line when GitHub could not be read', async () => {
    api.refreshOne.mockResolvedValueOnce({ watches: [closed], problem: 'not_connected' });
    const button = mount();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'GitHub is not connected. Connect GitHub in Settings.',
      ),
    );

    api.refreshOne.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('GitHub did not answer. Try again.'),
    );
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('is a real button, so Enter and Space reach it', () => {
    const button = mount();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});
