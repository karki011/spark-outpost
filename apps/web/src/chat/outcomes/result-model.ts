import type { CheckpointPayload, PrWatch } from '@spark-outpost/contracts';
import { changesSummary } from '../checkpoints/checkpoint-model.ts';
import { PULL_STATE_LABELS, pullState } from '../pull-request/pull-request-model.ts';

export function keptLine(payload: Pick<CheckpointPayload, 'files' | 'lines'>): string {
  if (payload.files.length === 0) return 'Kept · no file changes';
  return `Kept · ${changesSummary(payload)}`;
}

export interface ChecksFact {
  text: string;
  tone: 'ok' | 'bad' | 'plain';
}

function counted(count: number): string {
  return `${count} check${count === 1 ? '' : 's'}`;
}

export function checksFact(checks: CheckpointPayload['checks']): ChecksFact | null {
  if (!checks) return null;
  if (checks.failed > 0) return { text: `${counted(checks.failed)} failing`, tone: 'bad' };
  if (checks.unsettled > 0) {
    return { text: `${counted(checks.unsettled)} not settled`, tone: 'plain' };
  }
  return { text: `${counted(checks.passed)} passed`, tone: 'ok' };
}

export function keptAtLine(keptAt: CheckpointPayload['keptAt']): string | null {
  if (!keptAt?.branch) return null;
  return keptAt.commit ? `${keptAt.branch} · ${keptAt.commit}` : `${keptAt.branch} · not committed`;
}

const OPENED_HERE: ReadonlySet<PrWatch['opened']['via']> = new Set(['ship', 'agent']);
const REFERENCES_SHOWN = 2;

export interface PullReference {
  number: number;
  url: string;
  state: string;
}

export function pullReferences(watches: readonly PrWatch[]): PullReference[] {
  return watches
    .filter((watch) => OPENED_HERE.has(watch.opened.via))
    .toSorted((a, b) => b.opened.at.localeCompare(a.opened.at))
    .slice(0, REFERENCES_SHOWN)
    .map((watch) => ({
      number: watch.number,
      url: watch.url,
      state: PULL_STATE_LABELS[pullState(watch)],
    }));
}
