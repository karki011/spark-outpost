import {
  isStacked,
  requestState,
  stackWarnings,
  storyOrder,
  type OutpostStory,
  type StackFacts,
  type StackWarning,
  type StoryTask,
} from '@spark-outpost/contracts';
import type { StackGit, StoryTaskRow } from './ports.ts';

const FALLBACK_DEFAULT_BRANCH = 'main';

function unknown(): Promise<never> {
  return Promise.reject(new Error('The repository was not asked.'));
}

export const UNKNOWN_STACK: StackGit = { isAncestor: unknown, branchOnRemote: unknown };

type RowsByChat = ReadonlyMap<string, StoryTaskRow>;

function parentOf(row: StoryTaskRow, rows: RowsByChat): StoryTaskRow | null {
  const parentId = row.task.dependsOnConversationId;
  return parentId === null ? null : (rows.get(parentId) ?? null);
}

function ownedBranch(row: StoryTaskRow): string | null {
  return row.ownsBranch ? row.branch : null;
}

function defaultBranchOf(row: StoryTaskRow, rows: RowsByChat): string {
  const seen = new Set<string>();
  let root = row;
  for (let parent = parentOf(root, rows); parent !== null; parent = parentOf(root, rows)) {
    if (seen.has(parent.task.conversationId)) break;
    seen.add(parent.task.conversationId);
    root = parent;
  }
  return root.baseBranch ?? FALLBACK_DEFAULT_BRANCH;
}

async function known<T>(answer: Promise<T>, unknown: T): Promise<T> {
  return answer.catch(() => unknown);
}

async function stackFacts(
  row: StoryTaskRow,
  parent: StoryTaskRow,
  rows: RowsByChat,
  git: StackGit,
): Promise<StackFacts> {
  const parentBranch = ownedBranch(parent);
  const { repoRoot, branch } = row;
  const canAsk = repoRoot !== null && parentBranch !== null;
  return {
    handle: row.handle,
    parentHandle: parent.handle,
    defaultBranch: defaultBranchOf(row, rows),
    branch,
    pull: row.pull ? { state: row.pull.state, base: row.pull.base } : null,
    parentBranch,
    parentOnRemote: canAsk ? await known(git.branchOnRemote(repoRoot, parentBranch), true) : true,
    parentInBranch:
      canAsk && branch !== null
        ? await known(git.isAncestor(repoRoot, parentBranch, branch), null)
        : null,
    parentState: parent.opening?.facts ? requestState(parent.opening.facts).state : null,
    parentPull: parent.pull ? { state: parent.pull.state } : null,
  };
}

async function warningsOf(
  row: StoryTaskRow,
  parent: StoryTaskRow | null,
  rows: RowsByChat,
  git: StackGit,
): Promise<StackWarning[]> {
  if (parent === null || !isStacked(row, parent)) return [];
  return stackWarnings(await stackFacts(row, parent, rows, git));
}

async function toStoryTask(row: StoryTaskRow, rows: RowsByChat, git: StackGit): Promise<StoryTask> {
  const parent = parentOf(row, rows);
  const derived = row.opening?.facts ? requestState(row.opening.facts) : null;
  return {
    conversationId: row.task.conversationId,
    handle: row.handle,
    title: row.task.title,
    position: row.task.position,
    dependsOn: row.task.dependsOnConversationId,
    dependsOnHandle: parent?.handle ?? null,
    stacked: isStacked(row, parent),
    openingPostId: row.task.openingPostId,
    state: derived?.state ?? null,
    reason: derived?.reason ?? null,
    branch: row.branch,
    pullRequest: row.pull
      ? {
          number: row.pull.number,
          url: row.pull.url,
          state: row.pull.state,
          draft: row.pull.draft,
          base: row.pull.base,
        }
      : null,
    warnings: await warningsOf(row, parent, rows, git),
  };
}

function inOrder(rows: readonly StoryTaskRow[]): StoryTaskRow[] {
  const byChat = new Map(rows.map((row) => [row.task.conversationId, row]));
  return storyOrder(
    rows.map((row) => ({
      conversationId: row.task.conversationId,
      dependsOn: row.task.dependsOnConversationId,
      position: row.task.position,
    })),
  ).flatMap((item) => byChat.get(item.conversationId) ?? []);
}

function byStory(rows: readonly StoryTaskRow[]): StoryTaskRow[][] {
  const groups = new Map<string | null, StoryTaskRow[]>();
  for (const row of rows) {
    const group = groups.get(row.task.draftId);
    if (group) group.push(row);
    else groups.set(row.task.draftId, [row]);
  }
  return [...groups.values()];
}

export async function toStories(
  rows: readonly StoryTaskRow[],
  git: StackGit,
): Promise<OutpostStory[]> {
  const byChat = new Map(rows.map((row) => [row.task.conversationId, row]));
  const stories: OutpostStory[] = [];
  for (const group of byStory(rows)) {
    const lead = group.find((row) => row.task.leadConversationId !== null);
    const tasks: StoryTask[] = [];
    for (const row of inOrder(group)) tasks.push(await toStoryTask(row, byChat, git));
    stories.push({
      draftId: group[0]?.task.draftId ?? null,
      title: group[0]?.storyTitle ?? null,
      leadConversationId: lead?.task.leadConversationId ?? null,
      leadHandle: lead?.leadHandle ?? null,
      tasks,
    });
  }
  return stories;
}
