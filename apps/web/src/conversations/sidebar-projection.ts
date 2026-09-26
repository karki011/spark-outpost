import {
  LOOSE,
  NO_PROJECT,
  containerOf,
  destination,
  groupOf,
  listIn,
  pinnedIn,
  placed,
  type Layout,
} from './sidebar-order.ts';

export type Shift = 'in' | 'out';

export interface ProjectionInput {
  layout: Layout;
  chatId: string;
  pinned: boolean;
  projectIds: readonly string[];
  updatedAt: (chatId: string) => string;
}

export interface Projected {
  layout: Layout;
  group: string;
}

export function tailProject(layout: Layout, chatId: string): string | null {
  const container = containerOf(layout, chatId);
  if (!container) return null;
  const group = groupOf(container);
  if (group === NO_PROJECT) return null;
  const list = layout[listIn(group)] ?? [];
  if (container === listIn(group)) return list.at(-1) === chatId ? group : null;
  const pins = layout[pinnedIn(group)] ?? [];
  return pins.at(-1) === chatId && list.length === 0 ? group : null;
}

export function firstLoose(layout: Layout, updatedAt: (chatId: string) => string): string | null {
  const pinned = layout[pinnedIn(NO_PROJECT)] ?? [];
  if (pinned.length > 0) return pinned[0]!;
  const newest = (layout[LOOSE] ?? []).toSorted((a, b) => updatedAt(b).localeCompare(updatedAt(a)));
  return newest[0] ?? null;
}

function outOfProject({ layout, chatId, pinned }: ProjectionInput): Projected | null {
  if (!tailProject(layout, chatId)) return null;
  const to = destination(pinned, NO_PROJECT);
  return { layout: placed(layout, chatId, { container: to, index: 0 }), group: NO_PROJECT };
}

function intoLastProject(input: ProjectionInput): Projected | null {
  const { layout, chatId, pinned, projectIds, updatedAt } = input;
  const project = projectIds.at(-1);
  if (!project || firstLoose(layout, updatedAt) !== chatId) return null;
  const to = destination(pinned, project);
  const index = (layout[to] ?? []).filter((id) => id !== chatId).length;
  return { layout: placed(layout, chatId, { container: to, index }), group: project };
}

export function projected(input: ProjectionInput, shift: Shift): Projected | null {
  return shift === 'out' ? outOfProject(input) : intoLastProject(input);
}
