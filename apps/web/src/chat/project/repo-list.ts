import { CONVERSATION_PROJECTS_MAX, type Project } from '@spark-outpost/contracts';

export type RepoChange =
  | { type: 'add'; projectId: string }
  | { type: 'remove'; projectId: string }
  | { type: 'primary'; projectId: string }
  | { type: 'clear' };

export function applyRepoChange(ids: readonly string[], change: RepoChange): string[] {
  if (change.type === 'clear') return [];
  const others = ids.filter((id) => id !== change.projectId);
  if (change.type === 'remove') return others;
  if (change.type === 'primary') {
    return ids.includes(change.projectId) ? [change.projectId, ...others] : [...ids];
  }
  if (ids.includes(change.projectId)) return [...ids];
  return [...ids, change.projectId].slice(0, CONVERSATION_PROJECTS_MAX);
}

export function repoSummary(names: readonly string[]): string {
  const [primary, ...rest] = names;
  if (!primary) return '';
  return rest.length > 0 ? `${primary} +${rest.length}` : primary;
}

export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const merged: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index++) {
    for (const list of lists) {
      const item = list[index];
      if (item !== undefined) merged.push(item);
    }
  }
  return merged;
}

function usedAt(project: Pick<Project, 'createdAt' | 'lastUsedAt'>): string {
  return project.lastUsedAt ?? project.createdAt;
}

export function recentProjects<T extends Pick<Project, 'id' | 'createdAt' | 'lastUsedAt'>>(
  projects: readonly T[],
  linkedIds: ReadonlySet<string>,
  limit: number,
): T[] {
  return projects
    .filter((project) => !linkedIds.has(project.id))
    .sort((a, b) => usedAt(b).localeCompare(usedAt(a)))
    .slice(0, limit);
}

export const PICK_PROJECT_HINT = 'Pick a project to work in your code.';
