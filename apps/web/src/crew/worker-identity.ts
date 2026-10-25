import type { SubagentRow } from '@spark-outpost/contracts';
import type { CrewAgent } from './crew-model.ts';

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

export function stageWorker(row: SubagentRow, lead: CrewAgent): CrewAgent {
  const settled = { done: 'Done', failed: 'Failed', cancelled: 'Stopped' };
  const line =
    row.state === 'working'
      ? row.step?.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Working'
      : settled[row.state];
  return {
    id: row.id,
    name: row.name,
    role: workerRole(row.name) ?? 'Sub-agent',
    provider: lead.provider,
    model: row.usage?.model ?? null,
    effort: null,
    state: row.state === 'cancelled' ? 'stopped' : row.state,
    line,
    tokens: row.usage?.tokens ?? null,
    costUsd: row.usage?.costUsd ?? null,
    costSource: null,
    durationMs: row.usage?.durationMs ?? null,
  };
}
