import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { eachByRepo, startWorktreeSweeper, type Sweep } from './chat-worktree-sweep.ts';

const db = {} as Queryable;

function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sweeping worktrees by repository', () => {
  it('keeps one repository serial and runs at most the limit of repositories at once', async () => {
    const running = new Map<string, number>();
    let reposAtOnce = 0;
    let mostRepos = 0;
    let mostInOneRepo = 0;
    const order: string[] = [];
    const items = ['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'd1'].map((name) => ({
      name,
      repoRoot: `/repo/${name[0]}`,
    }));
    await eachByRepo(items, 2, async ({ name, repoRoot }) => {
      const inRepo = (running.get(repoRoot) ?? 0) + 1;
      running.set(repoRoot, inRepo);
      if (inRepo === 1) reposAtOnce += 1;
      mostInOneRepo = Math.max(mostInOneRepo, inRepo);
      mostRepos = Math.max(mostRepos, reposAtOnce);
      await settle();
      order.push(name);
      running.set(repoRoot, inRepo - 1);
      if (inRepo === 1) reposAtOnce -= 1;
    });
    expect(mostInOneRepo).toBe(1);
    expect(mostRepos).toBe(2);
    expect(order.filter((name) => name.startsWith('a'))).toEqual(['a1', 'a2', 'a3']);
    expect(order).toHaveLength(7);
  });

  it('does nothing for no worktrees', async () => {
    const work = vi.fn(async () => undefined);
    await eachByRepo([], 4, work);
    expect(work).not.toHaveBeenCalled();
  });
});

describe('the worktree sweeper', () => {
  it('sweeps at start and never starts a sweep while one is running', async () => {
    let running = 0;
    let most = 0;
    let sweeps = 0;
    const sweep: Sweep = async () => {
      sweeps += 1;
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
    };
    const sweeper = startWorktreeSweeper(db, 1, sweep);
    expect(sweeps).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await sweeper.stop();
    expect(sweeps).toBeGreaterThan(1);
    expect(most).toBe(1);
  });

  it('stops taking worktrees and waits for the sweep in progress', async () => {
    const release = gate();
    let seen: AbortSignal | null = null;
    let finished = false;
    const sweep: Sweep = async (_db, _exclusive, signal) => {
      seen = signal;
      await release.opened;
      finished = true;
    };
    const sweeper = startWorktreeSweeper(db, 60_000, sweep);
    let stopped = false;
    const stopping = sweeper.stop().then(() => {
      stopped = true;
    });
    await settle();
    expect(seen!.aborted).toBe(true);
    expect(stopped).toBe(false);
    release.open();
    await stopping;
    expect(finished).toBe(true);
  });

  it('keeps sweeping after a sweep fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let sweeps = 0;
    const sweep: Sweep = async () => {
      sweeps += 1;
      if (sweeps === 1) throw new Error('git is gone');
    };
    const sweeper = startWorktreeSweeper(db, 1, sweep);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await sweeper.stop();
    expect(sweeps).toBeGreaterThan(1);
    expect(console.error).toHaveBeenCalledWith('Could not sweep chat worktrees', expect.any(Error));
  });

  it('holds other exclusive work while a release runs, and lets go after a failure', async () => {
    const sweeper = startWorktreeSweeper(db, 60_000, async () => undefined);
    const release = gate();
    const order: string[] = [];
    const first = sweeper.exclusive(async () => {
      await release.opened;
      order.push('release');
      throw new Error('remove failed');
    });
    const claim = sweeper.exclusive(async () => {
      order.push('claim');
      return 'lease';
    });
    await settle();
    expect(order).toEqual([]);
    release.open();
    await expect(first).rejects.toThrow('remove failed');
    await expect(claim).resolves.toBe('lease');
    expect(order).toEqual(['release', 'claim']);
    await sweeper.stop();
  });
});
