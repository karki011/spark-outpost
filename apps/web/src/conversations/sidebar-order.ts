import type { ActiveGroups } from './sidebar-groups.ts';

export const NO_PROJECT = 'none';
export const LOOSE = 'loose';

export type Layout = Readonly<Record<string, readonly string[]>>;

export type DropTarget =
  | { kind: 'chat'; id: string; below: boolean }
  | { kind: 'project'; projectId: string; top: boolean }
  | { kind: 'loose' };

export interface Landing {
  container: string;
  index: number;
}

export interface ChatDrop {
  chatId: string;
  from: string;
  to: string;
  order: string[] | null;
}

export const pinnedIn = (group: string): string => `pin:${group}`;
export const listIn = (projectId: string): string => `list:${projectId}`;

export function groupOf(container: string): string {
  if (container === LOOSE) return NO_PROJECT;
  return container.slice(container.indexOf(':') + 1);
}

export function isSortable(container: string): boolean {
  return container !== LOOSE;
}

export function chatLayout({ groups, loose }: ActiveGroups): Layout {
  const layout: Record<string, string[]> = {};
  const ids = (chats: ActiveGroups['loose'], pinned: boolean) =>
    chats.filter((chat) => Boolean(chat.pinnedAt) === pinned).map((chat) => chat.id);
  for (const { project, chats } of groups) {
    layout[pinnedIn(project.id)] = ids(chats, true);
    layout[listIn(project.id)] = ids(chats, false);
  }
  layout[pinnedIn(NO_PROJECT)] = ids(loose, true);
  layout[LOOSE] = ids(loose, false);
  return layout;
}

export function containerOf(layout: Layout, id: string): string | null {
  return Object.keys(layout).find((container) => layout[container]!.includes(id)) ?? null;
}

export function destination(pinned: boolean, group: string): string {
  if (pinned) return pinnedIn(group);
  return group === NO_PROJECT ? LOOSE : listIn(group);
}

export function landing(
  layout: Layout,
  chatId: string,
  pinned: boolean,
  target: DropTarget,
): Landing | null {
  const from = containerOf(layout, chatId);
  if (!from) return null;
  if (target.kind === 'chat') {
    const overContainer = target.id === chatId ? null : containerOf(layout, target.id);
    if (!overContainer) return null;
    const to = destination(pinned, groupOf(overContainer));
    if (to === from) return null;
    const items = layout[to] ?? [];
    if (to === overContainer) {
      return { container: to, index: items.indexOf(target.id) + (target.below ? 1 : 0) };
    }
    return { container: to, index: pinned ? items.length : 0 };
  }
  const group = target.kind === 'project' ? target.projectId : NO_PROJECT;
  const to = destination(pinned, group);
  if (to === from) return null;
  const top = target.kind === 'project' && target.top;
  return { container: to, index: top ? 0 : (layout[to] ?? []).length };
}

export function placed(layout: Layout, chatId: string, { container, index }: Landing): Layout {
  const next: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(layout)) next[key] = ids.filter((id) => id !== chatId);
  const items = next[container] ?? [];
  items.splice(Math.min(index, items.length), 0, chatId);
  next[container] = items;
  return next;
}

export function moved(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function sorted(layout: Layout, activeId: string, overId: string): Layout {
  const container = containerOf(layout, activeId);
  if (!container || !isSortable(container)) return layout;
  const ids = layout[container]!;
  const to = ids.indexOf(overId);
  if (to < 0 || overId === activeId) return layout;
  return { ...layout, [container]: moved(ids, ids.indexOf(activeId), to) };
}

export function chatDrop(start: Layout, end: Layout, chatId: string): ChatDrop | null {
  const from = containerOf(start, chatId);
  const to = containerOf(end, chatId);
  if (!from || !to) return null;
  const order = isSortable(to) ? [...end[to]!] : null;
  const reordered = order !== null && order.join() !== (start[to] ?? []).join();
  if (from === to && !reordered) return null;
  return { chatId, from, to, order };
}

export function position(layout: Layout, chatId: string): { index: number; count: number } {
  const container = containerOf(layout, chatId);
  const ids = container ? layout[container]! : [];
  return { index: ids.indexOf(chatId) + 1, count: ids.length };
}
