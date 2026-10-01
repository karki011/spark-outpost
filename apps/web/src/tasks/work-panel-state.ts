import { useEffect, useState } from 'react';
import type { TaskOverview } from '@spark-outpost/contracts';

const STORAGE_KEY = 'spark-wp';
const WIDTH_KEY = 'spark-outpost.work-panel.width';
const WIDE_QUERY = '(min-width: 1101px)';
export const WORK_PANEL_MIN_WIDTH = 340;
export const WORK_PANEL_MAX_WIDTH = 640;
export const WORK_PANEL_DEFAULT_WIDTH = 432;

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

export function clampPanelWidth(width: number): number {
  return Math.round(Math.min(WORK_PANEL_MAX_WIDTH, Math.max(WORK_PANEL_MIN_WIDTH, width)));
}

function readWidth(): number | null {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved > 0 ? clampPanelWidth(saved) : null;
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

function isWide(): boolean {
  return typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches;
}

export interface WorkPanelState {
  open: boolean;
  wide: boolean;
  width: number | null;
  setOpen(open: boolean): void;
  setWidth(width: number | null): void;
}

export function useWorkPanelState(): WorkPanelState {
  const [wide, setWide] = useState(isWide);
  const [docked, setDocked] = useState(() => readSaved() ?? true);
  const [sheet, setSheet] = useState(false);
  const [width, setWidthState] = useState(readWidth);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(WIDE_QUERY);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return {
    wide,
    open: wide ? docked : sheet,
    width,
    setWidth(next) {
      const clamped = next === null ? null : clampPanelWidth(next);
      setWidthState(clamped);
      saveWidth(clamped);
    },
    setOpen(open) {
      if (wide) {
        setDocked(open);
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
  setWidth(width: number | null): void;
  setOpen(open: boolean): void;
  openTask(taskId: string): void;
}

export function useTaskPanel(tasks: readonly TaskOverview[], hasSettings: boolean): TaskPanel {
  const state = useWorkPanelState();
  const [chosen, setChosen] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const task = tasks.find((candidate) => candidate.id === chosen) ?? tasks.at(-1) ?? null;
  return {
    task,
    available: task !== null || hasSettings,
    open: task ? state.open : hasSettings && settingsOpen,
    wide: state.wide,
    width: state.width,
    setWidth: state.setWidth,
    setOpen(open) {
      if (task) state.setOpen(open);
      else setSettingsOpen(open);
    },
    openTask(taskId) {
      setChosen(taskId);
      state.setOpen(true);
    },
  };
}
