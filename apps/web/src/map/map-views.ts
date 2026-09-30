import { useCallback, useState } from 'react';
import { z } from 'zod';

export const MAP_VIEWS = ['tree', 'focus', 'outline', 'sky'] as const;
export type MapViewId = (typeof MAP_VIEWS)[number];

export const VIEW_LABELS: Record<MapViewId, string> = {
  tree: 'Tree',
  focus: 'Focus',
  outline: 'Outline',
  sky: 'Sky',
};

export const VIEW_TIPS: Record<MapViewId, string> = {
  tree: 'Click a group to open it · Arrow keys move between boxes, Enter opens, Esc closes · F focuses a file',
  focus: 'Focus shows what breaks if you change a file · Pick one with / or from the tree',
  outline:
    'Every group, area and file in one list · Sort by importance, name, size or recent change',
  sky: 'An overview of the whole map · Brighter stars matter more · Scroll to zoom, click an area',
};

const VIEW_KEY = 'spark-outpost.map-view';
const TIPS_KEY = 'spark-outpost.map-tips';
const viewSchema = z.enum(MAP_VIEWS);

function read<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function useMapView(phone: boolean) {
  const [saved, setSaved] = useState(() =>
    read(VIEW_KEY, (raw) => viewSchema.safeParse(raw).data ?? null),
  );
  const view: MapViewId = saved ?? (phone ? 'outline' : 'tree');
  const choose = useCallback((next: MapViewId) => {
    setSaved(next);
    write(VIEW_KEY, next);
  }, []);
  return [view, choose] as const;
}

export function useViewTips() {
  const [dismissed, setDismissed] = useState<MapViewId[]>(
    () => read(TIPS_KEY, (raw) => z.array(viewSchema).safeParse(raw).data ?? null) ?? [],
  );
  const dismiss = useCallback((view: MapViewId) => {
    setDismissed((previous) => {
      const next = [...new Set([...previous, view])];
      write(TIPS_KEY, next);
      return next;
    });
  }, []);
  return { dismissed, dismiss };
}
