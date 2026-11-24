import type {
  Approval,
  CommandRun,
  ConversationDetail,
  Run,
  TaskOverview,
} from '@spark-outpost/contracts';
import { runIndex, withDescendants } from './run-index.ts';

type DetailKey = keyof ConversationDetail;
type Conversation = ConversationDetail['conversation'];

const PER_RUN_KEYS = new Set<DetailKey>([
  'activity',
  'orchestrations',
  'advice',
  'runs',
  'conversation',
  'approvals',
  'commands',
  'tasks',
]);

const UNREAD_CONVERSATION_KEYS = new Set<keyof Conversation>(['latestRun']);

export function turnRunIds(detail: ConversationDetail, runId: string): string[] {
  const orchestration = detail.orchestrations?.[runId];
  const members = [...(orchestration?.crew ?? []), ...(orchestration?.answers ?? [])];
  return [runId, ...members.map((member) => member.runId)];
}

function turnFamily(before: ConversationDetail, after: ConversationDetail, run: Run): Set<string> {
  const family = new Set<string>();
  withDescendants(runIndex(before.runs), turnRunIds(before, run.id), family);
  const grown = new Set<string>();
  withDescendants(runIndex(after.runs), [...family, ...turnRunIds(after, run.id)], grown);
  return grown;
}

function sameConversation(before: Conversation, after: Conversation): boolean {
  if (before === after) return true;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof Conversation)[]);
  for (const key of keys) {
    if (UNREAD_CONVERSATION_KEYS.has(key)) continue;
    if (before[key] !== after[key]) return false;
  }
  return true;
}

type ByRun<Item> = ReadonlyMap<string, readonly Item[]>;

function groupedBy<Item>(items: readonly Item[], runIds: (item: Item) => readonly string[]) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    for (const runId of runIds(item)) {
      const group = groups.get(runId);
      if (group) group.push(item);
      else groups.set(runId, [item]);
    }
  }
  return groups;
}

function cachedByRun<Item>(runIds: (item: Item) => readonly string[]) {
  const cache = new WeakMap<readonly Item[], ByRun<Item>>();
  return (items: readonly Item[] | undefined): ByRun<Item> | null => {
    if (!items) return null;
    let groups = cache.get(items);
    if (!groups) {
      groups = groupedBy(items, runIds);
      cache.set(items, groups);
    }
    return groups;
  };
}

const approvalsByRun = cachedByRun<Approval>((approval) => [approval.runId]);
const commandsByRun = cachedByRun<CommandRun>((command) => [command.runId]);
const tasksByRun = cachedByRun<TaskOverview>((task) => task.runIds);

function sameItems<Item>(before: readonly Item[] = [], after: readonly Item[] = []): boolean {
  return before.length === after.length && before.every((item, index) => item === after[index]);
}

function sameSlices<Item>(
  before: readonly Item[] | undefined,
  after: readonly Item[] | undefined,
  byRun: (items: readonly Item[] | undefined) => ByRun<Item> | null,
  family: ReadonlySet<string>,
): boolean {
  if (before === after) return true;
  const groupsBefore = byRun(before);
  const groupsAfter = byRun(after);
  for (const id of family) {
    if (!sameItems(groupsBefore?.get(id), groupsAfter?.get(id))) return false;
  }
  return true;
}

function sameRunSlices(before: ConversationDetail, after: ConversationDetail, run: Run): boolean {
  const runsBefore = runIndex(before.runs);
  const runsAfter = runIndex(after.runs);
  if (runsBefore.latestTopLevelId !== runsAfter.latestTopLevelId) return false;
  const family = turnFamily(before, after, run);
  for (const id of family) {
    if (runsBefore.byId.get(id) !== runsAfter.byId.get(id)) return false;
    if (before.activity[id] !== after.activity[id]) return false;
    if (before.orchestrations?.[id] !== after.orchestrations?.[id]) return false;
    if (before.advice?.[id] !== after.advice?.[id]) return false;
  }
  return (
    sameSlices(before.approvals, after.approvals, approvalsByRun, family) &&
    sameSlices(before.commands, after.commands, commandsByRun, family) &&
    sameSlices(before.tasks, after.tasks, tasksByRun, family)
  );
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
  return (
    sameConversation(before.conversation, after.conversation) && sameRunSlices(before, after, run)
  );
}
