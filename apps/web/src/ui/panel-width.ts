import { useCallback, useState } from 'react';

export interface PanelWidthLimits {
  key: string;
  min: number;
  max: number;
  fallback: number;
}

export function clampPanelWidth(width: number, limits: PanelWidthLimits): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}

export function readPanelWidth(limits: PanelWidthLimits): number | null {
  try {
    const saved = Number(localStorage.getItem(limits.key));
    return saved > 0 ? clampPanelWidth(saved, limits) : null;
  } catch {
    return null;
  }
}

export function savePanelWidth(width: number | null, limits: PanelWidthLimits): void {
  try {
    if (width === null) localStorage.removeItem(limits.key);
    else localStorage.setItem(limits.key, String(width));
  } catch {
    return;
  }
}

export function useStoredPanelWidth(limits: PanelWidthLimits) {
  const [width, setWidthState] = useState(() => readPanelWidth(limits));
  const setWidth = useCallback(
    (next: number | null) => {
      const clamped = next === null ? null : clampPanelWidth(next, limits);
      setWidthState(clamped);
      savePanelWidth(clamped, limits);
    },
    [limits],
  );
  return [width, setWidth] as const;
}
