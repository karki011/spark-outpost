import type { ScreenReaderInstructions } from '@dnd-kit/core';
import { dragData, type DragData } from './sidebar-dnd-geometry.ts';
import {
  NO_PROJECT,
  containerOf,
  groupOf,
  isSortable,
  position,
  type Layout,
} from './sidebar-order.ts';

export interface DragSnapshot {
  layout: Layout;
  projectIds: readonly string[];
  chatTitle: (id: string) => string;
  projectName: (id: string) => string;
}

export const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    'To move this item, press Space or Enter. Use the up and down arrow keys to choose where it goes, and the right or left arrow keys to move a chat into the project above or out to Chats. Then press Space or Enter to drop it, or Escape to cancel.',
};

type Over = { id: string | number; data: { current?: unknown } } | null;

function chatPlace(snapshot: DragSnapshot, chatId: string, over: Over): string {
  const { layout } = snapshot;
  const container = containerOf(layout, chatId);
  if (!container) return 'Chats';
  const group = groupOf(container);
  const name = group === NO_PROJECT ? 'Chats' : snapshot.projectName(group);
  if (!isSortable(container)) return name;
  const { index, count } = position(layout, chatId);
  const overData = dragData(over);
  const overId = overData?.type === 'chat' ? overData.chatId : null;
  const sibling = overId !== null && containerOf(layout, overId) === container;
  const shown = sibling ? layout[container]!.indexOf(overId) + 1 : index;
  return `${name}, position ${shown} of ${count}`;
}

function projectPlace(snapshot: DragSnapshot, projectId: string, over: Over): string {
  const ids = snapshot.projectIds;
  const overData = dragData(over);
  const target = overData?.type === 'project' ? overData.projectId : projectId;
  return `position ${ids.indexOf(target) + 1} of ${ids.length}`;
}

function describe(snapshot: DragSnapshot, data: DragData | null, over: Over) {
  if (data?.type === 'chat') {
    return { name: snapshot.chatTitle(data.chatId), place: chatPlace(snapshot, data.chatId, over) };
  }
  if (data?.type === 'project') {
    const name = `project ${snapshot.projectName(data.projectId)}`;
    return { name, place: projectPlace(snapshot, data.projectId, over) };
  }
  return null;
}

export type DragMoment = 'start' | 'over' | 'end' | 'cancel';

type Active = { id: string | number; data: { current?: unknown } };

export function announcement(
  moment: DragMoment,
  snapshot: DragSnapshot,
  active: Active,
  over: Over,
): string | undefined {
  const data = dragData(active);
  if (moment === 'over' && over?.id === active.id) return undefined;
  const found = describe(snapshot, data, moment === 'over' ? over : null);
  if (!found) return undefined;
  if (moment === 'start') return `Picked up ${found.name}. It is in ${found.place}.`;
  if (moment === 'end') return `Dropped ${found.name} in ${found.place}.`;
  if (moment === 'cancel') return `Cancelled. ${found.name} stayed in ${found.place}.`;
  if (!over) return `${found.name} is not over a drop area.`;
  return `${found.name} will move to ${found.place}.`;
}

export function shiftAnnouncement(
  name: string,
  group: string | null,
  projectName: (id: string) => string,
): string {
  if (group === null || group === NO_PROJECT) return `${name} will move out to Chats.`;
  return `${name} will move into ${projectName(group)}.`;
}
