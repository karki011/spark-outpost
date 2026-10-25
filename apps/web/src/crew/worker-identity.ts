import type { SubagentRow, SubagentState } from '@spark-outpost/contracts';
import type { ChatFaceState } from '../brand/chat-face.ts';
import { isBusy, type CrewAgent, type CrewState } from './crew-model.ts';

const ROLES: Record<string, string> = {
  builder: 'Builder',
  explorer: 'Explorer',
  explore: 'Explorer',
  verifier: 'Verifier',
  reviewer: 'Reviewer',
  researcher: 'Researcher',
  tester: 'Tester',
};

export function workerRole(name: string): string | null {
  const token = /^(?:\[([^\]]+)\]|([^\s:]+)(?=\s|:|$))/.exec(name.trim());
  return ROLES[(token?.[1] ?? token?.[2] ?? '').trim().toLowerCase()] ?? null;
}

export function workerIdentity(id: string): string {
  return `worker:${id}`;
}

export function workerPresentation(
  state: SubagentState,
  live: boolean,
): {
  label: string;
  face: ChatFaceState;
  state: CrewState;
} {
  if (state === 'working') {
    return live
      ? { label: 'Working', face: 'working', state: 'working' }
      : { label: 'Inactive', face: 'idle', state: 'inactive' };
  }
  if (state === 'cancelled') return { label: 'Stopped', face: 'archived', state: 'stopped' };
  return { label: state === 'done' ? 'Done' : 'Failed', face: state, state };
}

export function stageWorker(row: SubagentRow, lead: CrewAgent): CrewAgent {
  const presentation = workerPresentation(
    row.state,
    isBusy(lead.state) || lead.state === 'waiting',
  );
  const line =
    presentation.state === 'working'
      ? row.step?.replace(/\s+/g, ' ').trim().slice(0, 80) || presentation.label
      : presentation.label;
  return {
    id: row.id,
    name: row.name,
    role: workerRole(row.name) ?? 'Sub-agent',
    provider: lead.provider,
    model: row.usage?.model ?? null,
    effort: null,
    state: presentation.state,
    line,
    tokens: row.usage?.tokens ?? null,
    costUsd: row.usage?.costUsd ?? null,
    costSource: null,
    durationMs: row.usage?.durationMs ?? null,
  };
}
