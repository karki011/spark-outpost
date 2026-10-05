import type { Approval, CrewMember, Message } from '@spark-outpost/contracts';
import { isCheckpoint, type CheckpointApproval } from '../checkpoints/checkpoint-model.ts';

type AgentItem = { kind: 'agent'; member: CrewMember; checkpoints: CheckpointApproval[] };

type LooseItem =
  { kind: 'checkpoint'; approval: CheckpointApproval } | { kind: 'approval'; approval: Approval };

type GroupItem = { kind: 'group'; members: AgentItem[] };

export type CrewItem = AgentItem | LooseItem | GroupItem;

const PARALLEL = new Set<CrewMember['placement']>(['shared', 'worktree']);

function isParallel(item: CrewItem | undefined): item is AgentItem {
  return item?.kind === 'agent' && PARALLEL.has(item.member.placement);
}

export function groupParallel(items: readonly CrewItem[]): CrewItem[] {
  const members = items.filter(isParallel);
  if (members.length < 2) return [...items];
  const first = items.indexOf(members[0]!);
  return items.flatMap((item, index) => {
    if (index === first) return [{ kind: 'group' as const, members }];
    return isParallel(item) ? [] : [item];
  });
}

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

function answeredOrPending(approval: Approval): boolean {
  return (
    approval.status === 'pending' ||
    approval.decidedBy === 'user' ||
    approval.payload.sparkResult !== undefined ||
    isCheckpoint(approval)
  );
}

export function shownApprovals(...lists: readonly (readonly Approval[])[]): Approval[] {
  return mergeApprovals(...lists).filter(answeredOrPending);
}

export function turnApprovals(
  runIds: readonly string[],
  stored: readonly Approval[],
  streamed: readonly Approval[],
): Approval[] {
  const own = new Set(runIds);
  return shownApprovals(
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
  rootRunId: string | null = null,
): CrewItem[] {
  const runIds = new Set(crew.map((member) => member.runId));
  const handedOffAt = rootRunId ? handOffAt(crew, rootRunId) : null;
  const afterHandOff = (approval: CheckpointApproval) =>
    approval.runId === rootRunId && handedOffAt !== null && approval.createdAt > handedOffAt;
  const own = (member: CrewMember) =>
    checkpoints.filter((approval) => approval.runId === member.runId && !afterHandOff(approval));
  const loose: LooseItem[] = [
    ...checkpoints
      .filter((approval) => !runIds.has(approval.runId) || afterHandOff(approval))
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

export function handOffAt(crew: readonly CrewMember[], rootRunId: string): string | null {
  const starts = crew
    .filter(
      (member) =>
        member.runId !== rootRunId && member.role !== 'spark' && member.startedAt !== null,
    )
    .map((member) => member.startedAt!)
    .sort();
  return starts[0] ?? null;
}

export function memberTexts(
  messages: readonly Message[],
  rootRunId: string,
  handedOffAt: string | null,
): Map<string, string> {
  const texts = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.runId) continue;
    if (message.runId !== rootRunId || handedOffAt === null) {
      texts.set(message.runId, message.content);
    } else if (message.createdAt < handedOffAt) {
      const earlier = texts.get(rootRunId);
      texts.set(rootRunId, earlier ? `${earlier}\n\n${message.content}` : message.content);
    }
  }
  return texts;
}
