import { describe, expect, it } from 'vitest';
import { cachedStackGit, createGitReadCache } from './git-read-cache.ts';

function setup() {
  let now = 0;
  const heads = new Map<string, string>([['/repo', 'a1']]);
  const snapshots: string[] = [];
  const cache = createGitReadCache({
    ttlMs: 15_000,
    now: () => now,
    snapshot: async (root) => {
      snapshots.push(root);
      return heads.get(root) ?? 'none';
    },
  });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loads;
  };
  return {
    cache,
    load,
    loadCount: () => loads,
    snapshots,
    moveHead: (sha: string) => heads.set('/repo', sha),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the git read cache', () => {
  it('answers a repeated read from the cache while the repository has not moved', async () => {
    const { cache, load, loadCount } = setup();
    expect(await cache.read('/repo', 'work', load)).toBe(1);
    expect(await cache.read('/repo', 'work', load)).toBe(1);
    expect(loadCount()).toBe(1);
  });

  it('reads again when the branch head moved', async () => {
    const { cache, load, moveHead } = setup();
    expect(await cache.read('/repo', 'work', load)).toBe(1);
    moveHead('b2');
    expect(await cache.read('/repo', 'work', load)).toBe(2);
  });

  it('reads again after the time to live, and not just before it', async () => {
    const { cache, load, advance } = setup();
    expect(await cache.read('/repo', 'work', load)).toBe(1);
    advance(14_999);
    expect(await cache.read('/repo', 'work', load)).toBe(1);
    advance(1);
    expect(await cache.read('/repo', 'work', load)).toBe(2);
  });

  it('keeps separate keys apart', async () => {
    const { cache, load } = setup();
    expect(await cache.read('/repo', 'one', load)).toBe(1);
    expect(await cache.read('/repo', 'two', load)).toBe(2);
  });

  it('shares one load between readers that ask at the same time', async () => {
    const { cache, loadCount, snapshots } = setup();
    let release: (value: number) => void = () => undefined;
    const slow = () =>
      new Promise<number>((resolve) => {
        release = resolve;
      });
    const first = cache.read('/repo', 'work', slow);
    const second = cache.read('/repo', 'work', slow);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(loadCount()).toBe(0);
    expect(snapshots).toEqual(['/repo']);
  });

  it('does not keep a failed read', async () => {
    const { cache, load } = setup();
    await expect(
      cache.read('/repo', 'work', () => Promise.reject(new Error('git failed'))),
    ).rejects.toThrow('git failed');
    expect(await cache.read('/repo', 'work', load)).toBe(1);
  });

  it('asks the stack once per branch pair until a ref moves', async () => {
    const { cache, moveHead } = setup();
    const calls: string[] = [];
    const stack = cachedStackGit(
      {
        isAncestor: async (_root, ancestor, descendant) => {
          calls.push(`${ancestor}>${descendant}`);
          return true;
        },
        branchOnRemote: async (_root, branch) => {
          calls.push(`remote ${branch}`);
          return false;
        },
      },
      cache,
    );
    await stack.isAncestor('/repo', 'p', 'c');
    await stack.isAncestor('/repo', 'p', 'c');
    await stack.branchOnRemote('/repo', 'p');
    await stack.branchOnRemote('/repo', 'p');
    expect(calls).toEqual(['p>c', 'remote p']);
    moveHead('c3');
    await stack.isAncestor('/repo', 'p', 'c');
    expect(calls).toEqual(['p>c', 'remote p', 'p>c']);
  });
});
