import { describe, expect, it, vi } from 'vitest';
import type { ChangedFile } from '@spark-outpost/contracts';
import type { ListedFile } from './change-list.ts';
import { buildChangeSet, ChangeSetCache, changePage, summarize } from './change-sets.ts';
import type { ListedRun } from './task-changes.ts';

const RUN_A = '00000000-0000-4000-8000-00000000000a';
const RUN_B = '00000000-0000-4000-8000-00000000000b';

function listed(path: string, added = 1, removed = 0): ListedFile {
  const file: ChangedFile = {
    path,
    change: 'modified',
    added,
    removed,
    oldText: null,
    newText: null,
    shown: 'text',
  };
  return { file, contents: () => Promise.resolve({ before: null, after: Buffer.from(path) }) };
}

function bigRuns(count: number): ListedRun[] {
  return [
    {
      runId: RUN_A,
      revertedAt: null,
      files: Array.from({ length: count }, (_, index) =>
        listed(`src/area${index % 10}/file${String(index).padStart(5, '0')}.ts`, 2, 1),
      ),
    },
    { runId: RUN_B, revertedAt: '2026-10-01T00:00:00.000Z', files: [listed('undone.ts', 99)] },
  ];
}

describe('change sets', () => {
  it('pages a 5,000 file set by path with folder groups and leaves reverted runs out', () => {
    const set = buildChangeSet('task', bigRuns(5000), 0, 'v1');
    const page = changePage(set, { offset: 200, limit: 200 });
    expect(page.total).toBe(5000);
    expect(page.files).toHaveLength(200);
    expect(page.files[0]!.path).toBe('src/area0/file02000.ts');
    expect(page.files[0]).not.toHaveProperty('oldText');
    expect(page.folders).toHaveLength(10);
    expect(page.folders[1]).toEqual({ path: 'src/area1', start: 500, count: 500 });
    expect(changePage(set, { offset: 4990, limit: 200 }).files).toHaveLength(10);
  });

  it('filters by text and run, and sums only live changes', () => {
    const set = buildChangeSet('task', bigRuns(20), 0, 'v1');
    expect(changePage(set, { offset: 0, limit: 50, q: 'AREA3/' }).total).toBe(2);
    expect(changePage(set, { offset: 0, limit: 50, runs: [RUN_B] }).total).toBe(0);
    const summary = summarize(set);
    expect(summary).toMatchObject({ files: 20, added: 40, removed: 20 });
    expect(summary.runs.map((run) => [run.runId, run.files, run.added])).toEqual([
      [RUN_A, 20, 40],
      [RUN_B, 1, 99],
    ]);
    expect(summary.top).toHaveLength(5);
  });

  it('serves pages from the same version until it expires', async () => {
    let now = 0;
    const load = vi.fn(() => Promise.resolve(bigRuns(3)));
    const cache = new ChangeSetCache(load, () => now);
    const first = await cache.fresh('task');
    expect(await cache.get('task', first.version)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await cache.get('other', first.version)).version).not.toBe(first.version);
    now = 11 * 60_000;
    expect((await cache.get('task', first.version)).version).not.toBe(first.version);
  });

  it('reads a file once per version', async () => {
    const cache = new ChangeSetCache(() => Promise.resolve(bigRuns(1)));
    const set = await cache.fresh('task');
    const entry = set.entries[0]!;
    const contents = vi.spyOn(entry.listed, 'contents');
    await cache.fileContents(set, entry);
    await cache.fileContents(set, entry);
    expect(contents).toHaveBeenCalledTimes(1);
  });
});
