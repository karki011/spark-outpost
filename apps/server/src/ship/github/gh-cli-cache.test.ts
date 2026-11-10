import { describe, expect, it } from 'vitest';
import { createTtlCache, GH_CLI_TTL_MS } from './gh-cli-cache.ts';

function counted<T>(value: T) {
  let calls = 0;
  return {
    load: async () => {
      calls += 1;
      return value;
    },
    calls: () => calls,
  };
}

describe('createTtlCache', () => {
  it('reuses a value within the ttl and reloads after it', async () => {
    const cache = createTtlCache<string>(GH_CLI_TTL_MS);
    const source = counted('a');
    await cache.get('k', 0, source.load);
    await cache.get('k', GH_CLI_TTL_MS - 1, source.load);
    expect(source.calls()).toBe(1);
    await cache.get('k', GH_CLI_TTL_MS, source.load);
    expect(source.calls()).toBe(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const cache = createTtlCache<string>(GH_CLI_TTL_MS);
    const source = counted('a');
    const results = await Promise.all([
      cache.get('k', 0, source.load),
      cache.get('k', 0, source.load),
      cache.get('k', 0, source.load),
    ]);
    expect(results).toEqual(['a', 'a', 'a']);
    expect(source.calls()).toBe(1);
  });

  it('keeps keys apart and forgets one or all on invalidate', async () => {
    const cache = createTtlCache<string>(GH_CLI_TTL_MS);
    const source = counted('a');
    await cache.get('one', 0, source.load);
    await cache.get('two', 0, source.load);
    cache.invalidate('one');
    await cache.get('one', 1, source.load);
    await cache.get('two', 1, source.load);
    expect(source.calls()).toBe(3);
    cache.invalidate();
    await cache.get('two', 2, source.load);
    expect(source.calls()).toBe(4);
  });

  it('does not keep a failed load', async () => {
    const cache = createTtlCache<string>(GH_CLI_TTL_MS);
    await expect(
      cache.get('k', 0, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const source = counted('a');
    expect(await cache.get('k', 1, source.load)).toBe('a');
    expect(source.calls()).toBe(1);
  });

  it('serves a value stored with set until it expires', async () => {
    const cache = createTtlCache<string>(GH_CLI_TTL_MS);
    cache.set('k', 0, 'fresh');
    const source = counted('stale');
    expect(await cache.get('k', 10, source.load)).toBe('fresh');
    expect(source.calls()).toBe(0);
  });
});
