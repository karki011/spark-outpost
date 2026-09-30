import { useState } from 'react';

const HEIGHT_KEY = 'spark-outpost.terminal.height';
export const DOCK_MIN_HEIGHT = 140;
export const DOCK_MAX_HEIGHT = 900;
export const DOCK_DEFAULT_HEIGHT = 280;

export function clampDockHeight(height: number, max = DOCK_MAX_HEIGHT): number {
  const ceiling = Math.max(DOCK_MIN_HEIGHT, Math.min(max, DOCK_MAX_HEIGHT));
  return Math.round(Math.min(ceiling, Math.max(DOCK_MIN_HEIGHT, height)));
}

export function readDockHeight(): number {
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEY));
    return saved > 0 ? clampDockHeight(saved) : DOCK_DEFAULT_HEIGHT;
  } catch {
    return DOCK_DEFAULT_HEIGHT;
  }
}

function saveDockHeight(height: number): void {
  try {
    localStorage.setItem(HEIGHT_KEY, String(height));
  } catch {
    return;
  }
}

export function useDockHeight(): [number, (height: number) => void] {
  const [height, setHeight] = useState(readDockHeight);
  const update = (next: number) => {
    setHeight(next);
    saveDockHeight(next);
  };
  return [height, update];
}
