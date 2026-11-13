import { useMemo } from 'react';
import type { LayoutInput, LayoutResult } from './tree-layout.ts';
import { useWorkerLayout, type WorkerLayout } from './use-worker-layout.ts';

function signature(input: LayoutInput): string {
  const nodes = input.nodes.map((n) => `${n.id}|${n.parent ?? ''}|${n.container ? 1 : 0}`);
  const edges = input.edges.map((e) => `${e.source}>${e.target}`);
  return `${input.columns ? 1 : 0}\n${nodes.join('\n')}\n${edges.join('\n')}`;
}

function createWorker(): Worker {
  return new Worker(new URL('./tree-layout-worker.ts', import.meta.url), { type: 'module' });
}

export type TreeLayout = WorkerLayout<LayoutResult>;

export function useTreeLayout(input: LayoutInput): TreeLayout | null {
  const key = useMemo(() => signature(input), [input]);
  return useWorkerLayout<LayoutInput, LayoutResult>(createWorker, input, key);
}
