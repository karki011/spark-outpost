import {
  closestCenter,
  pointerWithin,
  type Active,
  type Collision,
  type CollisionDetection,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { verticalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable';
import type { MouseEvent, TouchEvent } from 'react';

type Listeners = Record<string, unknown> | undefined;

interface PointerStart {
  onMouseDown?: (event: MouseEvent) => void;
  onTouchStart?: (event: TouchEvent) => void;
}

type Handler<E> = (event: E) => void;

export type DragData =
  | { type: 'chat'; chatId: string; pinned: boolean }
  | { type: 'project'; projectId: string }
  | { type: 'loose' };

const RANK: Record<DragData['type'], number> = { chat: 0, project: 1, loose: 2 };
const STEP_SLOP = 1;

export const projectDragId = (projectId: string): string => `project:${projectId}`;
export const LOOSE_DROP_ID = 'drop:loose';

export function dragData(
  entry: { data: { current?: unknown } } | null | undefined,
): DragData | null {
  const data = entry?.data.current as DragData | undefined;
  return data && 'type' in data ? data : null;
}

function accepts(active: Active | null, container: DroppableContainer): boolean {
  const target = dragData(container);
  if (!target || container.disabled) return false;
  return dragData(active)?.type === 'project' ? target.type === 'project' : true;
}

function rank(collision: Collision): number {
  const container = collision.data?.droppableContainer as DroppableContainer | undefined;
  const type = dragData(container)?.type;
  return type ? RANK[type] : RANK.loose;
}

const nearestTop: CollisionDetection = ({ collisionRect, droppableRects, droppableContainers }) => {
  const scored: Collision[] = [];
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const value = Math.abs(rect.top - collisionRect.top);
    scored.push({ id: container.id, data: { droppableContainer: container, value } });
  }
  const distance = (collision: Collision) => (collision.data?.value as number) ?? 0;
  return scored.sort((a, b) => distance(a) - distance(b) || rank(a) - rank(b)).slice(0, 1);
};

type CollisionArgs = Parameters<CollisionDetection>[0];

function isChat(container: DroppableContainer): boolean {
  return dragData(container)?.type === 'chat';
}

function inColumn({ pointerCoordinates, droppableRects, droppableContainers }: CollisionArgs) {
  const rects = droppableContainers.flatMap((container) => {
    const rect = droppableRects.get(container.id);
    return rect ? [rect] : [];
  });
  const x = pointerCoordinates?.x ?? Number.NaN;
  return rects.some((rect) => x >= rect.left && x <= rect.right);
}

function nearestChatIn(args: CollisionArgs, block: Collision): Collision[] {
  const bounds = args.droppableRects.get(block.id);
  if (!bounds) return [block];
  const inside = args.droppableContainers.filter((container) => {
    const rect = args.droppableRects.get(container.id);
    return isChat(container) && rect && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
  });
  const nearest = closestCenter({ ...args, droppableContainers: inside });
  return nearest.length > 0 ? nearest.slice(0, 1) : [block];
}

function pointerCollision(args: CollisionArgs): Collision[] {
  const [hit] = pointerWithin(args).sort((a, b) => rank(a) - rank(b));
  if (hit && rank(hit) === RANK.chat) return [hit];
  if (hit) return nearestChatIn(args, hit);
  if (!inColumn(args)) return [];
  const chats = args.droppableContainers.filter(isChat);
  return closestCenter({ ...args, droppableContainers: chats }).slice(0, 1);
}

export const sidebarCollision: CollisionDetection = (args) => {
  const droppableContainers = args.droppableContainers.filter((container) =>
    accepts(args.active, container),
  );
  const scoped = { ...args, droppableContainers };
  if (!args.pointerCoordinates) return nearestTop(scoped);
  if (dragData(args.active)?.type === 'project') return closestCenter(scoped);
  return pointerCollision(scoped);
};

export const sidebarKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context: { active, collisionRect, droppableRects, droppableContainers } },
) => {
  const down = event.code === 'ArrowDown';
  if (!down && event.code !== 'ArrowUp') return undefined;
  event.preventDefault();
  if (!active || !collisionRect) return undefined;
  const current = collisionRect.top;
  const tops = droppableContainers
    .getEnabled()
    .filter((container) => container.id !== active.id && accepts(active, container))
    .map((container) => droppableRects.get(container.id)?.top)
    .filter((top): top is number => top !== undefined);
  const ahead = down
    ? tops.filter((top) => top > current + STEP_SLOP)
    : tops.filter((top) => top < current - STEP_SLOP);
  if (ahead.length === 0) return currentCoordinates;
  const next = down ? Math.min(...ahead) : Math.max(...ahead);
  return { x: currentCoordinates.x, y: currentCoordinates.y + next - current };
};

export const listSorting: SortingStrategy = (args) =>
  args.activeIndex < 0 || args.overIndex < 0 ? null : verticalListSortingStrategy(args);

export const noSorting: SortingStrategy = () => null;

export function pointerStart(listeners: Listeners, enabled: boolean): PointerStart {
  if (!enabled || !listeners) return {};
  return {
    onMouseDown: listeners.onMouseDown as Handler<MouseEvent>,
    onTouchStart: listeners.onTouchStart as Handler<TouchEvent>,
  };
}
