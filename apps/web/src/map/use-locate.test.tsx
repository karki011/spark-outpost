// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDGES, PROJECT, SERVER, WEB, sampleDetail, sampleMap } from './map-samples.ts';
import { areaKey, buildScene } from './scene.ts';

const locate = vi.hoisted(() => vi.fn());
vi.mock('./map-api.ts', () => ({
  mapApi: { locate },
  mapKeys: {
    locate: (projectId: string, paths: readonly string[]) => ['locate', projectId, ...paths],
  },
}));
const { useLocate } = await import('./use-locate.ts');

const input = [{ projectId: PROJECT, name: 'app', map: sampleMap(PROJECT, [WEB, SERVER]) }];
const wanted = { projectId: PROJECT, paths: ['apps/server/src/tickets/store.ts'] };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  locate.mockReset();
});

describe('useLocate', () => {
  it('loads only the area the server names', async () => {
    locate.mockResolvedValue({ located: [{ path: wanted.paths[0], areaId: SERVER.id }] });
    const require = vi.fn();
    const scene = buildScene(input, new Map());
    const { result } = renderHook(() => useLocate(scene, wanted, require), { wrapper });
    expect(result.current).toBe('looking');
    await waitFor(() => expect(require).toHaveBeenCalledWith([areaKey(PROJECT, SERVER.id)]));
    expect(require).toHaveBeenCalledTimes(1);
    expect(locate).toHaveBeenCalledWith(PROJECT, wanted.paths);
  });

  it('reports missing without loading any area when the server finds none', async () => {
    locate.mockResolvedValue({ located: [{ path: wanted.paths[0], areaId: null }] });
    const require = vi.fn();
    const scene = buildScene(input, new Map());
    const { result } = renderHook(() => useLocate(scene, wanted, require), { wrapper });
    await waitFor(() => expect(result.current).toBe('missing'));
    expect(require).not.toHaveBeenCalled();
  });

  it('does not ask the server for a file already on the map', () => {
    const loaded = new Map([[areaKey(PROJECT, SERVER.id), sampleDetail(SERVER, EDGES)]]);
    const scene = buildScene(input, loaded);
    const { result } = renderHook(() => useLocate(scene, wanted, vi.fn()), { wrapper });
    expect(result.current).toBe('found');
    expect(locate).not.toHaveBeenCalled();
  });
});
