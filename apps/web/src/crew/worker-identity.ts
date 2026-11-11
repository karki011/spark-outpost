import type { SubagentRow, SubagentState, SubagentUsage } from '@spark-outpost/contracts';
import type { ChatFaceState } from '../brand/chat-face.ts';
import { AGENT_DEFAULT } from '../chat/composer/model-options.ts';
import { prettyModelId } from '../tasks/model-names.ts';
import { isBusy, modelLabel, type CrewAgent, type CrewState } from './crew-model.ts';

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

export function workerModel(
  usage: Pick<SubagentUsage, 'model' | 'effort'> | undefined,
): Pick<CrewAgent, 'model' | 'effort'> {
  const model = usage?.model;
  const known =
    model && model !== AGENT_DEFAULT ? (/\s/.test(model) ? model : prettyModelId(model)) : null;
  return { model: known, effort: known ? (usage?.effort ?? null) : null };
}

function comparable(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function runsOtherModel(
  usage: Pick<SubagentUsage, 'model' | 'effort'> | undefined,
  leadModel: string | null,
): boolean {
  const model = workerModel(usage).model;
  if (model === null || leadModel === null) return false;
  const worker = comparable(model);
  const lead = comparable(leadModel);
  return !worker.startsWith(lead) && !lead.startsWith(worker);
}

export function workerModelLabel(
  usage: Pick<SubagentUsage, 'model' | 'effort'> | undefined,
): string | null {
  const label = modelLabel({ role: 'agent', worker: true, ...workerModel(usage) });
  return label || null;
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
    blobId: workerIdentity(row.id),
    name: row.name,
    role: workerRole(row.name) ?? 'Sub-agent',
    provider: lead.provider,
    ...workerModel(row.usage),
    worker: true,
    state: presentation.state,
    line,
    tokens: row.usage?.tokens ?? null,
    costUsd: row.usage?.costUsd ?? null,
    costSource: null,
    durationMs: row.usage?.durationMs ?? null,
  };
}

export function teamAgents(
  members: readonly CrewAgent[],
  subagents: readonly SubagentRow[],
): CrewAgent[] {
  const lead = members[0];
  if (!lead) return [];
  const ids = new Set(members.map((member) => member.id));
  return [
    ...members,
    ...subagents
      .filter((row) => {
        if (ids.has(row.id)) return false;
        ids.add(row.id);
        return true;
      })
      .map((row) => stageWorker(row, lead)),
  ];
}
