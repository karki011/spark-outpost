import {
  CONVERSATION_PROJECTS_MAX,
  type ConversationSummary,
  type Project,
} from '@spark-outpost/contracts';
import { recencyBuckets } from './recency.ts';

export interface ProjectGroup {
  project: Project;
  chats: ConversationSummary[];
}

export interface ActiveGroups {
  groups: ProjectGroup[];
  loose: ConversationSummary[];
}

export interface DateGroup {
  label: string;
  chats: ConversationSummary[];
}

function comparePinned(a: ConversationSummary, b: ConversationSummary): number {
  if (!a.pinnedAt || !b.pinnedAt) return (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '');
  return (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0) || b.pinnedAt.localeCompare(a.pinnedAt);
}

export function pinnedFirst(chats: readonly ConversationSummary[]): ConversationSummary[] {
  return chats.toSorted(comparePinned);
}

export function pinnedSiblings(
  chats: readonly ConversationSummary[],
  chat: ConversationSummary,
): string[] {
  const home = chat.projectIds[0] ?? null;
  return pinnedFirst(chats)
    .filter((other) => other.pinnedAt && !other.archivedAt)
    .filter((other) => (other.projectIds[0] ?? null) === home)
    .map((other) => other.id);
}

export function movedOrder(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function activeGroups(
  chats: readonly ConversationSummary[],
  projects: readonly Project[],
): ActiveGroups {
  const byProject = new Map<string, ConversationSummary[]>(
    projects.map((project) => [project.id, []]),
  );
  const loose: ConversationSummary[] = [];
  for (const chat of pinnedFirst(chats)) {
    if (chat.archivedAt) continue;
    const bucket = chat.projectIds[0] ? byProject.get(chat.projectIds[0]) : undefined;
    (bucket ?? loose).push(chat);
  }
  return {
    groups: projects.map((project) => ({ project, chats: byProject.get(project.id) ?? [] })),
    loose,
  };
}

function dateGroups(
  chats: readonly ConversationSummary[],
  timeOf: (chat: ConversationSummary) => string,
  now: number,
): DateGroup[] {
  return recencyBuckets(chats, timeOf, now).map((bucket) => ({
    label: bucket.label,
    chats: bucket.items,
  }));
}

export function historyGroups(
  chats: readonly ConversationSummary[],
  now: number = Date.now(),
): DateGroup[] {
  const archived = chats.filter((chat) => chat.archivedAt);
  return dateGroups(archived, (chat) => chat.archivedAt ?? '', now);
}

export function looseBuckets(
  loose: readonly ConversationSummary[],
  now: number = Date.now(),
): DateGroup[] {
  const unpinned = loose.filter((chat) => !chat.pinnedAt);
  return dateGroups(unpinned, (chat) => chat.updatedAt, now);
}

export function movedProjectIds(current: readonly string[], target: string | null): string[] {
  if (target === null) return [];
  return [target, ...current.filter((id) => id !== target)].slice(0, CONVERSATION_PROJECTS_MAX);
}
