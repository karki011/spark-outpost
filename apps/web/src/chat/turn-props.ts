import type { ConversationDetail, Run } from '@spark-outpost/contracts';

type DetailKey = keyof ConversationDetail;

const PER_RUN_KEYS = new Set<DetailKey>(['activity', 'orchestrations', 'advice', 'runs']);

function turnRunIds(detail: ConversationDetail, runId: string): string[] {
  const crew = detail.orchestrations?.[runId]?.crew ?? [];
  return [runId, ...crew.map((member) => member.runId)];
}

function latestTopLevelId(detail: ConversationDetail): string | undefined {
  return detail.runs.findLast((run) => !run.parentRunId)?.id;
}

function sameRunSlices(before: ConversationDetail, after: ConversationDetail, run: Run): boolean {
  const ids = new Set([...turnRunIds(before, run.id), ...turnRunIds(after, run.id)]);
  if (latestTopLevelId(before) !== latestTopLevelId(after)) return false;
  const runsBefore = new Map(before.runs.map((candidate) => [candidate.id, candidate]));
  const runsAfter = new Map(after.runs.map((candidate) => [candidate.id, candidate]));
  for (const id of ids) {
    if (runsBefore.get(id) !== runsAfter.get(id)) return false;
    if (before.activity[id] !== after.activity[id]) return false;
    if (before.orchestrations?.[id] !== after.orchestrations?.[id]) return false;
    if (before.advice?.[id] !== after.advice?.[id]) return false;
  }
  return true;
}

export function sameTurnDetail(
  before: ConversationDetail,
  after: ConversationDetail,
  run: Run,
): boolean {
  if (before === after) return true;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as DetailKey[]);
  for (const key of keys) {
    if (PER_RUN_KEYS.has(key)) continue;
    if (before[key] !== after[key]) return false;
  }
  return sameRunSlices(before, after, run);
}
