import { useEffect, useState } from 'react';
import { useSidebarLayout } from '../conversations/sidebar-layout.tsx';
import { DOCK_QUERY, PHONE_QUERY, ROOMY_DOCK_QUERY, useMediaQuery } from '../ui/breakpoints.ts';
import type { TaskOverview } from '@spark-outpost/contracts';
import type { BrowserPaneChoice } from '../browser/pane-open.ts';
import type { ArtifactPaneChoice } from '../chat/artifacts/artifact-pane-store.ts';
import { PAGE_MIN_WIDTH } from '../browser/pane-width.ts';
import {
  clampPanelWidth,
  readPanelWidth,
  savePanelWidth,
  type PanelWidthLimits,
} from '../ui/panel-width.ts';

const STORAGE_KEY = 'spark-wp';
const WIDTH_KEY = 'spark-outpost.work-panel.width';
export const WORK_PANEL_MIN_WIDTH = 340;
export const WORK_PANEL_MAX_WIDTH = 640;
export const WORK_PANEL_DEFAULT_WIDTH = 432;

export const WORK_PANEL_LIMITS: PanelWidthLimits = {
  key: WIDTH_KEY,
  min: WORK_PANEL_MIN_WIDTH,
  max: WORK_PANEL_MAX_WIDTH,
  fallback: WORK_PANEL_DEFAULT_WIDTH,
};

export const BROWSER_PANEL_LIMITS: PanelWidthLimits = {
  key: 'spark-outpost.browser-pane.width',
  min: PAGE_MIN_WIDTH,
  max: 8000,
  fallback: 640,
};

export type PanelView = 'work' | 'browser' | 'artifact';

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

function usePanelDocks(): boolean {
  const docks = useMediaQuery(DOCK_QUERY);
  const roomy = useMediaQuery(ROOMY_DOCK_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);
  const sidebar = useSidebarLayout();
  return docks && !phone && (roomy || (sidebar?.collapsed ?? true));
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
  const wide = usePanelDocks();
  const [chosen, setChosen] = useState(readSaved);
  const docked = chosen ?? opensByDefault;
  const [sheet, setSheet] = useState(false);
  const [width, setWidthState] = useState(() => readPanelWidth(WORK_PANEL_LIMITS));
  const [browserWidth, setBrowserWidthState] = useState(() => readPanelWidth(BROWSER_PANEL_LIMITS));

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
      const clamped = next === null ? null : clampPanelWidth(next, WORK_PANEL_LIMITS);
      setWidthState(clamped);
      savePanelWidth(clamped, WORK_PANEL_LIMITS);
    },
    setBrowserWidth(next) {
      const clamped = next === null ? null : clampPanelWidth(next, BROWSER_PANEL_LIMITS);
      setBrowserWidthState(clamped);
      savePanelWidth(clamped, BROWSER_PANEL_LIMITS);
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
  closeBrowser(): void;
  openTask(taskId: string): void;
}

export function useTaskPanel(
  tasks: readonly TaskOverview[],
  hasSettings: boolean,
  opensByDefault = true,
  browser: BrowserPaneChoice | null = null,
  artifact: ArtifactPaneChoice | null = null,
): TaskPanel {
  const state = useWorkPanelState(opensByDefault);
  const [chosen, setChosen] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const task = tasks.find((candidate) => candidate.id === chosen) ?? tasks.at(-1) ?? null;
  const hasWork = task !== null || hasSettings;
  const reading = artifact?.current.shown === true;
  const browsing = !reading && browser !== null && browser.open;
  const workOpen = task ? state.open : hasSettings && settingsOpen;
  const view: PanelView = reading
    ? 'artifact'
    : browsing || (browser !== null && !hasWork)
      ? 'browser'
      : 'work';
  const wideView = view !== 'work';
  const setWorkOpen = (open: boolean) => {
    if (task) state.setOpen(open);
    else setSettingsOpen(open);
  };
  return {
    task,
    available: hasWork || browser !== null || artifact !== null,
    open: reading || browsing || workOpen,
    wide: state.wide,
    width: wideView ? state.browserWidth : state.width,
    view,
    limits: wideView ? BROWSER_PANEL_LIMITS : WORK_PANEL_LIMITS,
    setWidth: wideView ? state.setBrowserWidth : state.setWidth,
    setOpen(open) {
      if (open && !hasWork && !artifact) browser?.setOpen(true);
      if (open && !hasWork && artifact) artifact.setShown(true);
      if (open && hasWork) setWorkOpen(true);
      if (!open && reading) artifact.setShown(false);
      if (!open && browsing) browser.setOpen(false);
      if (!open && workOpen) setWorkOpen(false);
    },
    setView(next) {
      artifact?.setShown(next === 'artifact');
      browser?.setOpen(next === 'browser');
      if (next === 'work') setWorkOpen(true);
    },
    closeBrowser() {
      browser?.setOpen(false);
    },
    openTask(taskId) {
      setChosen(taskId);
      artifact?.setShown(false);
      browser?.setOpen(false);
      state.setOpen(true);
    },
  };
}
