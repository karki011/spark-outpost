import type { Approval, CrewMember } from '@spark-outpost/contracts';
import { isCheckpoint, type CheckpointApproval } from '../checkpoints/checkpoint-model.ts';

type AgentItem = { kind: 'agent'; member: CrewMember; checkpoints: CheckpointApproval[] };

export type CrewItem =
  | AgentItem
  | { kind: 'checkpoint'; approval: CheckpointApproval }
  | { kind: 'group'; group: string; members: AgentItem[] };

const STATUS_RANK: Record<Approval['status'], number> = {
  pending: 0,
  allowed: 1,
  denied: 1,
  cancelled: 1,
  expired: 1,
};

export function mergeCheckpoints(...lists: readonly (readonly Approval[])[]): CheckpointApproval[] {
  const byId = new Map<string, CheckpointApproval>();
  for (const approval of lists.flat()) {
    if (!isCheckpoint(approval)) continue;
    const known = byId.get(approval.id);
    if (!known || STATUS_RANK[approval.status] > STATUS_RANK[known.status]) {
      byId.set(approval.id, approval);
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function crewItems(
  crew: readonly CrewMember[],
  checkpoints: readonly CheckpointApproval[],
): CrewItem[] {
  const runIds = new Set(crew.map((member) => member.runId));
  const own = (member: CrewMember) =>
    checkpoints.filter((approval) => approval.runId === member.runId);
  const loose = checkpoints.filter((approval) => !runIds.has(approval.runId));
  const items: CrewItem[] = [];
  let next = 0;
  for (const member of crew) {
    const start = member.startedAt;
    while (start !== null && next < loose.length && loose[next]!.createdAt <= start) {
      items.push({ kind: 'checkpoint', approval: loose[next]! });
      next += 1;
    }
    items.push({ kind: 'agent', member, checkpoints: own(member) });
  }
  for (; next < loose.length; next += 1) {
    items.push({ kind: 'checkpoint', approval: loose[next]! });
  }
  return items;
}

export function lastAgentIndex(items: readonly CrewItem[]): number {
  return items.findLastIndex((item) => item.kind === 'agent');
}

export function groupParallel(items: readonly CrewItem[]): CrewItem[] {
  const grouped: CrewItem[] = [];
  for (const item of items) {
    const group = item.kind === 'agent' ? (item.member.parallelGroup ?? null) : null;
    const last = grouped.at(-1);
    if (item.kind !== 'agent' || group === null) {
      grouped.push(item);
    } else if (last?.kind === 'group' && last.group === group) {
      last.members.push(item);
    } else if (last?.kind === 'agent' && last.member.parallelGroup === group) {
      grouped[grouped.length - 1] = { kind: 'group', group, members: [last, item] };
    } else {
      grouped.push(item);
    }
  }
  return grouped;
}
