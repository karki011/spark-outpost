import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type Announcements,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  announcement,
  screenReaderInstructions,
  shiftAnnouncement,
  type DragMoment,
} from './sidebar-announcements.ts';
import {
  dragData,
  sidebarCollision,
  sidebarKeyboardCoordinates,
  SHIFT_STEP,
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
import { projected, type Shift } from './sidebar-projection.ts';

const HOLD_MS = 450;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 5;
const LANDED_MS = 320;
const SETTLE_MS = 300;
const SHIFT_ZONE = 18;

export interface Point {
  x: number;
  y: number;
}

interface SidebarDndOptions {
  layout: Layout;
  projectIds: readonly string[];
  chatTitle: (id: string) => string;
  updatedAt: (id: string) => string;
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

interface Held {
  before: Layout;
  anchorX: number;
  y: number;
  shift: Shift;
}

function effectiveLayout(layout: Layout, chatId: string, over: Over | null): Layout {
  const overData = dragData(over);
  return overData?.type === 'chat' ? sorted(layout, chatId, overData.chatId) : layout;
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
  const [shift, setShift] = useState<Shift | null>(null);
  const start = useRef<Layout>(options.layout);
  const current = useRef({ layout: options.layout, projectIds: options.projectIds });
  const latest = useRef(options);
  const justMoved = useRef(false);
  const pending = useRef<DragOverEvent | null>(null);
  const lastOver = useRef<DragOverEvent | null>(null);
  const delta = useRef({ x: 0, y: 0 });
  const anchorX = useRef(0);
  const held = useRef<Held | null>(null);
  const said = useRef<string | undefined>(undefined);
  const shifted = useRef(false);

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
    lastOver.current = null;
    held.current = null;
    setShift(null);
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
    delta.current = { x: 0, y: 0 };
    anchorX.current = 0;
    shifted.current = false;
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
      if (waiting && !held.current) moveChat(waiting);
    });
    anchorX.current = delta.current.x;
    shifted.current = false;
    setShift(null);
    setLayout(placed(current.current.layout, data.chatId, next));
  };

  const letGo = () => {
    held.current = null;
    setShift(null);
  };

  const shiftMessage = (chatId: string) => {
    const container = containerOf(current.current.layout, chatId);
    return shiftAnnouncement(
      latest.current.chatTitle(chatId),
      container ? groupOf(container) : null,
      latest.current.projectName,
    );
  };

  const shiftTo = (layout: Layout, chatId: string, direction: Shift) => {
    setLayout(layout);
    setShift(direction);
    shifted.current = true;
    said.current = shiftMessage(chatId);
  };

  const projectChat = (data: Extract<DragData, { type: 'chat' }>, event: DragMoveEvent) => {
    const offset = event.delta.x - anchorX.current;
    if (Math.abs(offset) < SHIFT_STEP) return;
    const direction: Shift = offset > 0 ? 'in' : 'out';
    const { layout, projectIds } = current.current;
    const next = projected(
      {
        layout: effectiveLayout(layout, data.chatId, event.over),
        chatId: data.chatId,
        pinned: data.pinned,
        projectIds,
        updatedAt: latest.current.updatedAt,
      },
      direction,
    );
    if (!next) return;
    held.current = { before: layout, anchorX: anchorX.current, y: event.delta.y, shift: direction };
    shiftTo(next.layout, data.chatId, direction);
  };

  const followHeld = (hold: Held, data: Extract<DragData, { type: 'chat' }>, x: number) => {
    const sign = hold.shift === 'in' ? 1 : -1;
    if ((x - hold.anchorX) * sign >= SHIFT_STEP / 2) return;
    held.current = null;
    anchorX.current = hold.anchorX;
    shiftTo(hold.before, data.chatId, hold.shift === 'in' ? 'out' : 'in');
  };

  const onDragMove = (event: DragMoveEvent) => {
    delta.current = event.delta;
    const data = dragData(event.active);
    if (data?.type !== 'chat') return;
    const hold = held.current;
    if (!hold) {
      projectChat(data, event);
      return;
    }
    if (Math.abs(event.delta.y - hold.y) <= SHIFT_ZONE) {
      followHeld(hold, data, event.delta.x);
      return;
    }
    letGo();
    anchorX.current = event.delta.x;
    if (lastOver.current) moveChat(lastOver.current);
  };

  const onDragOver = (event: DragOverEvent) => {
    lastOver.current = event;
    delta.current = event.delta;
    setOverSomething(event.over !== null);
    if (dragData(event.active)?.type !== 'chat') return;
    const hold = held.current;
    if (hold && event.over && Math.abs(event.delta.y - hold.y) <= SHIFT_ZONE) return;
    if (hold) letGo();
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
      overData?.type === 'chat' && !held.current
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
    onDragMove: () => {
      const text = said.current;
      said.current = undefined;
      return text;
    },
    onDragOver: (args) => {
      const data = dragData(args.active);
      if (shifted.current && data?.type === 'chat') return shiftMessage(data.chatId);
      return announce('over', args);
    },
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
      onDragMove,
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
    shift,
    busy: active !== null || settling,
  };
}

export type SidebarDnd = ReturnType<typeof useSidebarDnd>;
