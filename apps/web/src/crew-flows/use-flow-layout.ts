import { useMemo } from 'react';
import { useWorkerLayout, type WorkerLayout } from '../map/tree/use-worker-layout.ts';
import type { FlowLayoutInput, FlowLayoutResult } from './flow-layout.ts';

function createWorker(): Worker {
  return new Worker(new URL('./flow-layout-worker.ts', import.meta.url), { type: 'module' });
}

function signature(input: FlowLayoutInput): string {
  const nodes = input.nodes.map((node) => node.id).join('|');
  const edges = input.edges.map((edge) => `${edge.source}>${edge.target}`).join('|');
  return `${nodes}\n${edges}`;
}

export function useFlowLayout(input: FlowLayoutInput): WorkerLayout<FlowLayoutResult> | null {
  const key = useMemo(() => signature(input), [input]);
  return useWorkerLayout<FlowLayoutInput, FlowLayoutResult>(createWorker, input, key);
}
