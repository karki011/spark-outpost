import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapAreaDetail } from '@spark-outpost/contracts';
import { AreaLoader, type LoadedArea } from './area-loader.ts';
import { FIRST_PAGE } from './map-api.ts';
import { PROJECT, WEB, sampleDetail } from './map-samples.ts';

const KEY = `${PROJECT}:${WEB.id}`;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(detail: MapAreaDetail = sampleDetail(WEB, [])) {
  const fetch = vi.fn(async () => detail);
  const batches: ReadonlyMap<string, LoadedArea>[] = [];
  const loader = new AreaLoader(fetch, (batch) => batches.push(batch));
  loader.sync(new Map([[PROJECT, 'v1']]));
  return { fetch, batches, loader };
}

const visible = { key: KEY, screenRadius: 80, fileCount: 4, loaded: 0, visible: true };

describe('AreaLoader', () => {
  it('fetches visible areas once and delivers them in one batch', async () => {
    const { fetch, batches, loader } = setup();
    loader.want([visible]);
    loader.want([visible]);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(KEY, 4, 'v1');
    expect(batches).toHaveLength(1);
    expect(batches[0]!.get(KEY)!.version).toBe('v1');
    loader.want([visible]);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('loads a whole area on request, ahead of the zoom queue', async () => {
    const { fetch, loader } = setup(sampleDetail({ ...WEB, files: [...WEB.files] }, [], 2));
    loader.require([KEY]);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledWith(KEY, Infinity, 'v1');
  });

  it('forgets what it loaded when the map is rebuilt', async () => {
    const { fetch, loader } = setup();
    loader.want([{ ...visible, fileCount: 900 }]);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenLastCalledWith(KEY, FIRST_PAGE, 'v1');
    loader.sync(new Map([[PROJECT, 'v2']]));
    loader.want([{ ...visible, fileCount: 900 }]);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetches again when the map is rebuilt while a load is in flight', async () => {
    let finish: (detail: MapAreaDetail) => void = () => {};
    const fetch = vi.fn((_key: string, _limit: number, version: string): Promise<MapAreaDetail> =>
      version === 'v1'
        ? new Promise((resolve) => (finish = resolve))
        : Promise.resolve(sampleDetail(WEB, [])),
    );
    const batches: ReadonlyMap<string, LoadedArea>[] = [];
    const loader = new AreaLoader(fetch, (batch) => batches.push(batch));
    loader.sync(new Map([[PROJECT, 'v1']]));
    loader.want([visible]);
    loader.sync(new Map([[PROJECT, 'v2']]));
    loader.want([visible]);
    finish(sampleDetail(WEB, []));
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenLastCalledWith(KEY, 4, 'v2');
    expect(batches.flatMap((batch) => [...batch.values()].map((entry) => entry.version))).toEqual([
      'v2',
    ]);
  });
});
