import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { prefersReducedMotion } from '../../ui/motion.ts';
import type { DockApi } from './dock-context.ts';
import { withEntry, withoutEntry, type DockEntry } from './dock-model.ts';

const FOCUSABLE = 'textarea, input, button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PendingDockState {
  api: DockApi;
  entries: DockEntry[];
  chosen: string | null;
  choose(id: string): void;
  setSlot(id: string, element: HTMLElement | null): void;
  dockRef: RefObject<HTMLDivElement | null>;
}

function slotOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-dock-slot="${CSS.escape(id)}"]`);
}

function focusSlot(id: string) {
  const slot = slotOf(id);
  if (!slot) return;
  slot.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  const target = slot.querySelector<HTMLElement>(FOCUSABLE) ?? slot;
  target.focus({ preventScroll: true });
}

function useFocusHandoff(entries: readonly DockEntry[], dockRef: PendingDockState['dockRef']) {
  const hadFocus = useRef(false);
  const shown = useRef<readonly DockEntry[]>(entries);
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      hadFocus.current = dockRef.current?.contains(event.target as Node) ?? false;
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [dockRef]);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = entries;
    const left = before.some((entry) => !entries.some((now) => now.id === entry.id));
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!left || !lost || !hadFocus.current) return;
    const next = entries[0];
    if (next) {
      requestAnimationFrame(() => focusSlot(next.id));
      return;
    }
    hadFocus.current = false;
    document.querySelector<HTMLElement>('.composer textarea')?.focus({ preventScroll: true });
  }, [entries]);
}

export function usePendingDock(): PendingDockState {
  const [entries, setEntries] = useState<DockEntry[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [slots, setSlots] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map());
  const dockRef = useRef<HTMLDivElement | null>(null);
  useFocusHandoff(entries, dockRef);

  const register = useCallback((entry: DockEntry) => {
    setEntries((current) => withEntry(current, entry));
  }, []);
  const unregister = useCallback((id: string) => {
    setEntries((current) => withoutEntry(current, id));
  }, []);
  const jump = useCallback((id: string) => {
    setChosen(id);
    requestAnimationFrame(() => focusSlot(id));
  }, []);
  const setSlot = useCallback((id: string, element: HTMLElement | null) => {
    setSlots((current) => {
      if (element ? current.get(id) === element : !current.has(id)) return current;
      const next = new Map(current);
      if (element) next.set(id, element);
      else next.delete(id);
      return next;
    });
  }, []);

  const api = useMemo(
    () => ({ slots, register, unregister, jump }),
    [slots, register, unregister, jump],
  );
  return { api, entries, chosen, choose: setChosen, setSlot, dockRef };
}
