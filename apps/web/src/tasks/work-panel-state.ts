import { useEffect, useState } from 'react';
import type { TaskOverview } from '@spark-outpost/contracts';

const STORAGE_KEY = 'spark-wp';
const WIDTH_KEY = 'spark-outpost.work-panel.width';
const WIDE_QUERY = '(min-width: 1101px)';
export const WORK_PANEL_MIN_WIDTH = 340;
export const WORK_PANEL_MAX_WIDTH = 640;
export const WORK_PANEL_DEFAULT_WIDTH = 432;

export interface PanelWidthLimits {
  key: string;
  min: number;
  max: number;
  fallback: number;
}

export const WORK_PANEL_LIMITS: PanelWidthLimits = {
  key: WIDTH_KEY,
  min: WORK_PANEL_MIN_WIDTH,
  max: WORK_PANEL_MAX_WIDTH,
  fallback: WORK_PANEL_DEFAULT_WIDTH,
};

export const BROWSER_PANEL_LIMITS: PanelWidthLimits = {
  key: 'spark-outpost.browser-pane.width',
  min: 380,
  max: 1200,
  fallback: 640,
};

export type PanelView = 'work' | 'browser';

function readSaved(): boolean | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? null : saved === '1';
  } catch {
    return null;
  }
}

function save(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    return;
  }
}

const cleared = new Set<() => void>();

function removeSaved(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export function forgetPanelChoice(): void {
  removeSaved();
  for (const listener of cleared) listener();
}

export function clampPanelWidth(width: number, limits = WORK_PANEL_LIMITS): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}

function readWidth(limits = WORK_PANEL_LIMITS): number | null {
  try {
    const saved = Number(localStorage.getItem(limits.key));
    return saved > 0 ? clampPanelWidth(saved, limits) : null;
  } catch {
    return null;
  }
}

function saveWidth(width: number | null, limits = WORK_PANEL_LIMITS): void {
  try {
    if (width === null) localStorage.removeItem(limits.key);
    else localStorage.setItem(limits.key, String(width));
  } catch {
    return;
  }
}

function isWide(): boolean {
  return typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches;
}

export interface WorkPanelState {
  open: boolean;
  wide: boolean;
  width: number | null;
  browserWidth: number | null;
  setOpen(open: boolean): void;
  setWidth(width: number | null): void;
  setBrowserWidth(width: number | null): void;
}

export function useWorkPanelState(opensByDefault = true): WorkPanelState {
  const [wide, setWide] = useState(isWide);
  const [chosen, setChosen] = useState(readSaved);
  const docked = chosen ?? opensByDefault;
  const [sheet, setSheet] = useState(false);
  const [width, setWidthState] = useState(() => readWidth());
  const [browserWidth, setBrowserWidthState] = useState(() => readWidth(BROWSER_PANEL_LIMITS));

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(WIDE_QUERY);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onCleared = () => setChosen(null);
    cleared.add(onCleared);
    return () => {
      cleared.delete(onCleared);
    };
  }, []);

  return {
    wide,
    open: wide ? docked : sheet,
    width,
    browserWidth,
    setWidth(next) {
      const clamped = next === null ? null : clampPanelWidth(next);
      setWidthState(clamped);
      saveWidth(clamped);
    },
    setBrowserWidth(next) {
      const clamped = next === null ? null : clampPanelWidth(next, BROWSER_PANEL_LIMITS);
      setBrowserWidthState(clamped);
      saveWidth(clamped, BROWSER_PANEL_LIMITS);
    },
    setOpen(open) {
      if (wide) {
        setChosen(open);
        save(open);
      } else {
        setSheet(open);
      }
    },
  };
}

export interface TaskPanel {
  task: TaskOverview | null;
  available: boolean;
  open: boolean;
  wide: boolean;
  width: number | null;
  view: PanelView;
  limits: PanelWidthLimits;
  setWidth(width: number | null): void;
  setOpen(open: boolean): void;
  setView(view: PanelView): void;
  openTask(taskId: string): void;
}

export function useTaskPanel(
  tasks: readonly TaskOverview[],
  hasSettings: boolean,
  opensByDefault = true,
  hasBrowser = false,
): TaskPanel {
  const state = useWorkPanelState(opensByDefault);
  const [chosen, setChosen] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wanted, setWanted] = useState<PanelView>('work');
  const task = tasks.find((candidate) => candidate.id === chosen) ?? tasks.at(-1) ?? null;
  const hasWork = task !== null || hasSettings;
  const view: PanelView = hasBrowser && (wanted === 'browser' || !hasWork) ? 'browser' : 'work';
  const setOpen = (open: boolean) => {
    if (task) state.setOpen(open);
    else setSettingsOpen(open);
  };
  return {
    task,
    available: hasWork || hasBrowser,
    open: task ? state.open : (hasSettings || hasBrowser) && settingsOpen,
    wide: state.wide,
    width: view === 'browser' ? state.browserWidth : state.width,
    view,
    limits: view === 'browser' ? BROWSER_PANEL_LIMITS : WORK_PANEL_LIMITS,
    setWidth: view === 'browser' ? state.setBrowserWidth : state.setWidth,
    setOpen,
    setView(next) {
      setWanted(next);
      setOpen(true);
    },
    openTask(taskId) {
      setChosen(taskId);
      setWanted('work');
      state.setOpen(true);
    },
  };
}
