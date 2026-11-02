// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IslandRequest } from '@spark-outpost/contracts';
import { islandRequestsApi, useIslandRequests } from './island-requests.ts';

const SNOOZE: IslandRequest = {
  id: '6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  kind: 'snooze_meeting',
  target: 'evt@2026-10-20T10:00:00.000Z',
};
const ASIDE: IslandRequest = {
  id: '7b2a1d3f-4c5e-4f6a-9b0c-1d2e3f4a5b6c',
  kind: 'join_meeting',
  target: 'evt@2026-10-20T11:00:00.000Z',
};
const UNKNOWN: IslandRequest = {
  id: '8c3b2e4a-5d6f-4a7b-8c1d-2e3f4a5b6c7d',
  kind: 'snooze_meeting',
  target: 'gone@2026-10-20T10:00:00.000Z',
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useIslandRequests', () => {
  it('claims and applies only the requests it can handle, once each', async () => {
    vi.spyOn(islandRequestsApi, 'list').mockResolvedValue({ requests: [SNOOZE, ASIDE, UNKNOWN] });
    const claim = vi.spyOn(islandRequestsApi, 'claim').mockImplementation(async (id) => ({
      ...SNOOZE,
      id,
    }));
    const applied: string[] = [];
    const hook = renderHook(
      () =>
        useIslandRequests(['snooze_meeting'], (request) =>
          request.target === SNOOZE.target ? () => applied.push(request.id) : null,
        ),
      { wrapper },
    );
    await waitFor(() => expect(applied).toEqual([SNOOZE.id]));
    hook.rerender();
    await Promise.resolve();
    expect(claim.mock.calls).toEqual([[SNOOZE.id]]);
  });

  it('does nothing when another window claimed it first', async () => {
    vi.spyOn(islandRequestsApi, 'list').mockResolvedValue({ requests: [SNOOZE] });
    const claim = vi.spyOn(islandRequestsApi, 'claim').mockRejectedValue(new Error('409'));
    const applied: string[] = [];
    renderHook(() => useIslandRequests(['snooze_meeting'], () => () => applied.push('x')), {
      wrapper,
    });
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(applied).toEqual([]);
  });
});
