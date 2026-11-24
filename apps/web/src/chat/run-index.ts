import type { Run } from '@spark-outpost/contracts';

interface RunIndex {
  byId: ReadonlyMap<string, Run>;
  children: ReadonlyMap<string, readonly string[]>;
  topLevel: ReadonlySet<string>;
  latestTopLevelId: string | undefined;
}

const indexes = new WeakMap<readonly Run[], RunIndex>();

function buildRunIndex(runs: readonly Run[]): RunIndex {
  const byId = new Map<string, Run>();
  const children = new Map<string, string[]>();
  const topLevel = new Set<string>();
  let latestTopLevelId: string | undefined;
  for (const run of runs) {
    byId.set(run.id, run);
    if (!run.parentRunId) {
      topLevel.add(run.id);
      latestTopLevelId = run.id;
      continue;
    }
    const siblings = children.get(run.parentRunId);
    if (siblings) siblings.push(run.id);
    else children.set(run.parentRunId, [run.id]);
  }
  return { byId, children, topLevel, latestTopLevelId };
}

export function runIndex(runs: readonly Run[]): RunIndex {
  let index = indexes.get(runs);
  if (!index) {
    index = buildRunIndex(runs);
    indexes.set(runs, index);
  }
  return index;
}

export function withDescendants(index: RunIndex, ids: Iterable<string>, into: Set<string>): void {
  const queue = [...ids];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (into.has(next)) continue;
    into.add(next);
    queue.push(...(index.children.get(next) ?? []));
  }
}
