import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type Announcements,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  announcement,
  screenReaderInstructions,
  type DragMoment,
} from './sidebar-announcements.ts';
import {
  dragData,
  sidebarCollision,
  sidebarKeyboardCoordinates,
  type DragData,
} from './sidebar-dnd-geometry.ts';
import {
  chatDrop,
  containerOf,
  groupOf,
  landing,
  moved,
  placed,
  sorted,
  type ChatDrop,
  type DropTarget,
  type Layout,
} from './sidebar-order.ts';

const HOLD_MS = 450;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 5;
const LANDED_MS = 320;
const SETTLE_MS = 300;

export interface Point {
  x: number;
  y: number;
}

interface SidebarDndOptions {
  layout: Layout;
  projectIds: readonly string[];
  chatTitle: (id: string) => string;
  projectName: (id: string) => string;
  onChatDrop: (drop: ChatDrop) => void;
  onProjectsDrop: (projectIds: string[]) => void;
  onHold: (chatId: string, point: Point) => void;
}

function dropTarget(over: Over | null, active: DragOverEvent['active']): DropTarget | null {
  const data = dragData(over);
  if (!over || !data) return null;
  const rect = active.rect.current.translated;
  const below = rect ? rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2 : false;
  if (data.type === 'chat') return { kind: 'chat', id: data.chatId, below };
  if (data.type === 'project') return { kind: 'project', projectId: data.projectId, top: !below };
  return { kind: 'loose' };
}

function touchPoint(event: Event): Point | null {
  if (typeof TouchEvent === 'undefined' || !(event instanceof TouchEvent)) return null;
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

export function useSidebarDnd(options: SidebarDndOptions) {
  const [active, setActive] = useState<DragData | null>(null);
  const [dragLayout, setDragLayout] = useState<Layout | null>(null);
  const [dragProjects, setDragProjects] = useState<readonly string[] | null>(null);
  const [overSomething, setOverSomething] = useState(false);
  const [landed, setLanded] = useState<{ group: string; key: number } | null>(null);
  const [settling, setSettling] = useState(false);
  const [home, setHome] = useState<string | null>(null);
  const start = useRef<Layout>(options.layout);
  const current = useRef({ layout: options.layout, projectIds: options.projectIds });
  const latest = useRef(options);
  const justMoved = useRef(false);
  const pending = useRef<DragOverEvent | null>(null);

  useEffect(() => {
    latest.current = options;
    if (!active) current.current = { layout: options.layout, projectIds: options.projectIds };
  });

  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), LANDED_MS);
    return () => clearTimeout(timer);
  }, [landed]);

  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_SLOP } }),
    useSensor(TouchSensor, { activationConstraint: { delay: HOLD_MS, tolerance: TOUCH_SLOP } }),
    useSensor(KeyboardSensor, { coordinateGetter: sidebarKeyboardCoordinates }),
  );

  const setLayout = (layout: Layout) => {
    current.current = { ...current.current, layout };
    setDragLayout(layout);
  };

  const finish = () => {
    pending.current = null;
    setActive(null);
    setDragLayout(null);
    setDragProjects(null);
    setOverSomething(false);
    setSettling(true);
  };

  const onDragStart = ({ active: dragged, activatorEvent }: DragStartEvent) => {
    const data = dragData(dragged);
    if (!data) return;
    const { layout, projectIds } = latest.current;
    start.current = layout;
    current.current = { layout, projectIds };
    setActive(data);
    setDragLayout(layout);
    setDragProjects(projectIds);
    const from = data.type === 'chat' ? containerOf(layout, data.chatId) : null;
    setHome(from ? groupOf(from) : null);
    if (touchPoint(activatorEvent)) navigator.vibrate?.(8);
  };

  const moveChat = (event: DragOverEvent) => {
    const data = dragData(event.active);
    const target = dropTarget(event.over, event.active);
    if (data?.type !== 'chat' || !target) return;
    const next = landing(current.current.layout, data.chatId, data.pinned, target);
    if (!next) return;
    justMoved.current = true;
    requestAnimationFrame(() => {
      justMoved.current = false;
      const waiting = pending.current;
      pending.current = null;
      if (waiting) moveChat(waiting);
    });
    setLayout(placed(current.current.layout, data.chatId, next));
  };

  const onDragOver = (event: DragOverEvent) => {
    setOverSomething(event.over !== null);
    if (dragData(event.active)?.type !== 'chat') return;
    pending.current = null;
    if (!event.over) {
      setLayout(start.current);
      return;
    }
    if (justMoved.current) pending.current = event;
    else moveChat(event);
  };

  const endChat = (data: Extract<DragData, { type: 'chat' }>, event: DragEndEvent) => {
    const { over, delta, activatorEvent } = event;
    const point = touchPoint(activatorEvent);
    const still = Math.hypot(delta.x, delta.y) < TOUCH_SLOP;
    if (point && still) {
      current.current = { ...current.current, layout: start.current };
      latest.current.onHold(data.chatId, point);
      return;
    }
    if (!over) {
      current.current = { ...current.current, layout: start.current };
      return;
    }
    const overData = dragData(over);
    const end =
      overData?.type === 'chat'
        ? sorted(current.current.layout, data.chatId, overData.chatId)
        : current.current.layout;
    current.current = { ...current.current, layout: end };
    const drop = chatDrop(start.current, end, data.chatId);
    if (!drop) return;
    latest.current.onChatDrop(drop);
    if (groupOf(drop.from) !== groupOf(drop.to)) {
      setLanded({ group: groupOf(drop.to), key: Date.now() });
    }
  };

  const endProject = (data: Extract<DragData, { type: 'project' }>, over: Over | null) => {
    const overData = dragData(over);
    const ids = current.current.projectIds;
    if (overData?.type !== 'project' || overData.projectId === data.projectId) return;
    const next = moved(ids, ids.indexOf(data.projectId), ids.indexOf(overData.projectId));
    current.current = { ...current.current, projectIds: next };
    latest.current.onProjectsDrop(next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const data = dragData(event.active);
    if (data?.type === 'chat') endChat(data, event);
    if (data?.type === 'project') endProject(data, event.over);
    finish();
  };

  const onDragCancel = () => {
    current.current = { layout: start.current, projectIds: latest.current.projectIds };
    finish();
  };

  const announce = useCallback(
    (moment: DragMoment, { active: dragged, over }: Parameters<Announcements['onDragOver']>[0]) =>
      announcement(
        moment,
        {
          ...current.current,
          chatTitle: latest.current.chatTitle,
          projectName: latest.current.projectName,
        },
        dragged,
        over,
      ),
    [],
  );
  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => announce('start', { active: dragged, over: null }),
    onDragOver: (args) => announce('over', args),
    onDragEnd: (args) => announce('end', args),
    onDragCancel: (args) => announce('cancel', args),
  };

  const layout = dragLayout ?? options.layout;
  const activeChatId = active?.type === 'chat' ? active.chatId : null;
  const activeContainer = activeChatId ? containerOf(layout, activeChatId) : null;
  const group = activeContainer ? groupOf(activeContainer) : null;

  return {
    context: {
      sensors,
      collisionDetection: sidebarCollision,
      measuring: { droppable: { strategy: MeasuringStrategy.Always } },
      modifiers: active?.type === 'project' ? [restrictToVerticalAxis] : [],
      accessibility: {
        announcements,
        screenReaderInstructions,
      },
      onDragStart,
      onDragOver,
      onDragEnd,
      onDragCancel,
    },
    active,
    layout,
    projectIds: dragProjects ?? options.projectIds,
    overGroup: overSomething && group !== home ? group : null,
    leftHome: group !== null && group !== home,
    landed,
    busy: active !== null || settling,
  };
}

export type SidebarDnd = ReturnType<typeof useSidebarDnd>;
