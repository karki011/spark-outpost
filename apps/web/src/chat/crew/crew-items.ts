import type { Approval, CrewMember } from '@spark-outpost/contracts';
import { isCheckpoint, type CheckpointApproval } from '../checkpoints/checkpoint-model.ts';

type AgentItem = { kind: 'agent'; member: CrewMember; checkpoints: CheckpointApproval[] };

type LooseItem =
  { kind: 'checkpoint'; approval: CheckpointApproval } | { kind: 'approval'; approval: Approval };

export type CrewItem = AgentItem | LooseItem;

const STATUS_RANK: Record<Approval['status'], number> = {
  pending: 0,
  allowed: 1,
  denied: 1,
  cancelled: 1,
  expired: 1,
};

export function mergeApprovals(...lists: readonly (readonly Approval[])[]): Approval[] {
  const byId = new Map<string, Approval>();
  for (const approval of lists.flat()) {
    const known = byId.get(approval.id);
    if (!known || STATUS_RANK[approval.status] > STATUS_RANK[known.status]) {
      byId.set(approval.id, approval);
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function turnApprovals(
  runIds: readonly string[],
  stored: readonly Approval[],
  streamed: readonly Approval[],
): Approval[] {
  const own = new Set(runIds);
  return mergeApprovals(
    stored.filter((approval) => own.has(approval.runId)),
    streamed,
  );
}

export function mergeCheckpoints(...lists: readonly (readonly Approval[])[]): CheckpointApproval[] {
  return mergeApprovals(...lists).filter(isCheckpoint);
}

export function crewItems(
  crew: readonly CrewMember[],
  checkpoints: readonly CheckpointApproval[],
  runApprovals: readonly Approval[] = [],
): CrewItem[] {
  const runIds = new Set(crew.map((member) => member.runId));
  const own = (member: CrewMember) =>
    checkpoints.filter((approval) => approval.runId === member.runId);
  const loose: LooseItem[] = [
    ...checkpoints
      .filter((approval) => !runIds.has(approval.runId))
      .map((approval) => ({ kind: 'checkpoint' as const, approval })),
    ...runApprovals.map((approval) => ({ kind: 'approval' as const, approval })),
  ].sort((a, b) => a.approval.createdAt.localeCompare(b.approval.createdAt));
  const items: CrewItem[] = [];
  let next = 0;
  for (const member of crew) {
    const start = member.startedAt;
    while (start !== null && next < loose.length && loose[next]!.approval.createdAt <= start) {
      items.push(loose[next]!);
      next += 1;
    }
    items.push({ kind: 'agent', member, checkpoints: own(member) });
  }
  items.push(...loose.slice(next));
  return items;
}

export function lastAgentIndex(items: readonly CrewItem[]): number {
  return items.findLastIndex((item) => item.kind === 'agent');
}
