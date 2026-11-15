import { escapeBelongsToSurface } from '../ui/foreground-surface.ts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePhone } from '../ui/breakpoints.ts';
import { keysText, SIDEBAR_KEYS as SIDEBAR_SHORTCUT } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { useMenuCommand } from '../desktop/use-menu-command.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { dockedSideWidth, floatsSidebar } from './sidebar-room.ts';

const COLLAPSED_KEY = 'spark-outpost.sidebar.collapsed';
const WIDTH_KEY = 'spark-outpost.sidebar.width';
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 300;
export const SIDEBAR_HINT = keysText(SIDEBAR_SHORTCUT);
const SIDEBAR_ARIA_KEYS = MAC ? 'Control+Meta+S' : 'Control+Alt+S';
const TOGGLE_SIDEBAR_COMMAND = 'toggle-sidebar';
const EDGE_SWIPE_START = 28;
const SWIPE_DISTANCE = 60;

export interface SidebarLayout {
  collapsed: boolean;
  drawer: boolean;
  narrow: boolean;
  floating: boolean;
  attention: boolean;
  hidden: boolean;
  width: number | null;
  setWidth: (width: number | null) => void;
  toggle: () => void;
  reveal: () => void;
  closeDrawer: () => void;
  reportRoom: (id: string, width: number | null) => void;
}

const SidebarLayoutContext = createContext<SidebarLayout | null>(null);

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    return;
  }
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

function readWidth(): number | null {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved > 0 ? clampWidth(saved) : null;
  } catch {
    return null;
  }
}

function saveWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    return;
  }
}

function useEdgeSwipe(narrow: boolean, drawer: boolean, setDrawer: (open: boolean) => void) {
  useEffect(() => {
    if (!narrow) return;
    let startX: number | null = null;
    const onStart = (event: TouchEvent) => {
      const x = event.touches[0]?.clientX ?? 0;
      startX = x < EDGE_SWIPE_START || drawer ? x : null;
    };
    const onEnd = (event: TouchEvent) => {
      if (startX === null) return;
      const dx = (event.changedTouches[0]?.clientX ?? startX) - startX;
      startX = null;
      if (dx > SWIPE_DISTANCE && !drawer) setDrawer(true);
      else if (dx < -SWIPE_DISTANCE && drawer) setDrawer(false);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [narrow, drawer, setDrawer]);
}

function isSidebarShortcut(event: KeyboardEvent): boolean {
  const modifiers = MAC
    ? event.ctrlKey && event.metaKey && !event.altKey
    : event.ctrlKey && event.altKey && !event.metaKey && !event.getModifierState('AltGraph');
  return modifiers && !event.shiftKey && event.code === 'KeyS';
}

let focusAfterSwap = false;

function rememberToggleFocus(): void {
  focusAfterSwap = document.activeElement?.closest('.side-toggle, .side-collapse') != null;
}

function takeSwapFocus(button: HTMLButtonElement | null): void {
  if (!focusAfterSwap || !button) return;
  focusAfterSwap = false;
  button.focus({ preventScroll: true });
}

function useCrampedChat(collapsed: boolean, width: number | null, onChange: () => void) {
  const [cramped, setCramped] = useState(false);
  const rooms = useRef(new Map<string, number>());
  const pending = useRef(false);
  const latest = useRef({ collapsed, width, cramped, onChange });
  useLayoutEffect(() => {
    latest.current = { collapsed, width, cramped, onChange };
  });
  const decide = useCallback(() => {
    pending.current = false;
    const now = latest.current;
    const next = floatsSidebar({
      rooms: [...rooms.current.values()],
      sideWidth: dockedSideWidth(now.width, SIDEBAR_DEFAULT_WIDTH, window.innerWidth),
      docked: !now.cramped && !now.collapsed,
      floating: now.cramped,
    });
    if (next === now.cramped) return;
    now.cramped = next;
    setCramped(next);
    now.onChange();
  }, []);
  const reportRoom = useCallback(
    (id: string, room: number | null) => {
      if (room === null) rooms.current.delete(id);
      else rooms.current.set(id, room);
      if (pending.current) return;
      pending.current = true;
      queueMicrotask(decide);
    },
    [decide],
  );
  return { cramped, reportRoom };
}

function useEscapeCloses(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (escapeBelongsToSurface(event, document.querySelector('nav.side'))) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);
}

export function useSidebarLayoutState(attention: boolean): SidebarLayout {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [width, setWidthState] = useState(readWidth);
  const narrow = usePhone();
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const { cramped, reportRoom } = useCrampedChat(collapsed, width, closeDrawer);
  const floating = narrow || cramped;
  useEdgeSwipe(narrow, drawer, setDrawer);
  useEscapeCloses(cramped && !narrow && drawer, closeDrawer);

  useEffect(() => saveCollapsed(collapsed), [collapsed]);

  const flip = useCallback(() => {
    rememberToggleFocus();
    if (floating) setDrawer((open) => !open);
    else setCollapsed((hidden) => !hidden);
  }, [floating]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSidebarShortcut(event)) return;
      event.preventDefault();
      flip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flip]);

  useMenuCommand((command) => {
    if (command === TOGGLE_SIDEBAR_COMMAND) flip();
  });

  return useMemo(
    () => ({
      collapsed,
      drawer: floating && drawer,
      narrow,
      floating,
      attention,
      hidden: floating ? !drawer : collapsed,
      width,
      setWidth: (next) => {
        const clamped = next === null ? null : clampWidth(next);
        setWidthState(clamped);
        saveWidth(clamped);
      },
      toggle: () => {
        rememberToggleFocus();
        if (floating) setDrawer((open) => !open);
        else setCollapsed(!collapsed);
      },
      reveal: () => (floating ? setDrawer(true) : setCollapsed(false)),
      closeDrawer,
      reportRoom,
    }),
    [collapsed, drawer, narrow, floating, attention, width, closeDrawer, reportRoom],
  );
}

export function SidebarLayoutProvider({
  value,
  children,
}: {
  value: SidebarLayout;
  children: ReactNode;
}) {
  return <SidebarLayoutContext value={value}>{children}</SidebarLayoutContext>;
}

export function useSidebarLayout(): SidebarLayout | null {
  return useContext(SidebarLayoutContext);
}

function PanelLeftIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function SidebarToggle() {
  const layout = useSidebarLayout();
  const ref = useRef<HTMLButtonElement>(null);
  const alert = layout?.attention ?? false;
  const label = alert ? 'Open sidebar. A chat needs your input' : 'Show sidebar';
  const tip = useTooltip(label, { keys: SIDEBAR_SHORTCUT });
  const hidden = layout?.hidden ?? false;
  useLayoutEffect(() => {
    if (hidden) takeSwapFocus(ref.current);
  }, [hidden]);
  if (!layout?.hidden) return null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`icon-btn side-toggle${alert ? ' alert' : ''}`}
        aria-label={label}
        aria-keyshortcuts={SIDEBAR_ARIA_KEYS}
        aria-expanded={false}
        {...tip.triggerProps}
        onClick={layout.toggle}
      >
        <PanelLeftIcon />
      </button>
      {tip.tooltip}
    </>
  );
}

export function SidebarCollapseButton() {
  const layout = useSidebarLayout();
  const ref = useRef<HTMLButtonElement>(null);
  const label = layout?.floating ? 'Close sidebar' : 'Hide sidebar';
  const tip = useTooltip(label, { keys: SIDEBAR_SHORTCUT });
  const hidden = layout?.hidden ?? true;
  useLayoutEffect(() => {
    if (!hidden) takeSwapFocus(ref.current);
  }, [hidden]);
  if (!layout) return null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-btn side-collapse"
        aria-label={label}
        aria-keyshortcuts={SIDEBAR_ARIA_KEYS}
        aria-expanded={!layout.hidden}
        {...tip.triggerProps}
        onClick={layout.toggle}
      >
        <PanelLeftIcon />
      </button>
      {tip.tooltip}
    </>
  );
}
