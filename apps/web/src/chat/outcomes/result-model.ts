import type { CheckpointPayload, PrWatch } from '@spark-outpost/contracts';
import { changesSummary } from '../checkpoints/checkpoint-model.ts';

export function keptLine(payload: Pick<CheckpointPayload, 'files' | 'lines'>): string {
  if (payload.files.length === 0) return 'Kept · no file changes';
  return `Kept · ${changesSummary(payload)}`;
}

const OPENED_HERE: ReadonlySet<PrWatch['opened']['via']> = new Set(['ship', 'agent']);
const REFERENCES_SHOWN = 2;

export interface PullReference {
  number: number;
  url: string;
}

export function pullReferences(watches: readonly PrWatch[]): PullReference[] {
  return watches
    .filter((watch) => OPENED_HERE.has(watch.opened.via))
    .toSorted((a, b) => b.opened.at.localeCompare(a.opened.at))
    .slice(0, REFERENCES_SHOWN)
    .map((watch) => ({ number: watch.number, url: watch.url }));
}
