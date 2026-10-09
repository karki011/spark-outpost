import type { IslandGeometry } from '../desktop/desktop-bridge.ts';

const MIN_STRIP = 24;

interface NotchFit {
  hugsNotch: boolean;
  strip: number;
  notchHeight: number;
}

export function notchFit(geometry: IslandGeometry): NotchFit {
  const hugsNotch = geometry.notch && geometry.docked;
  if (!hugsNotch) return { hugsNotch, strip: geometry.top, notchHeight: 0 };
  const lowered = Math.max(0, geometry.windowTop ?? 0);
  return {
    hugsNotch,
    strip: geometry.top - lowered,
    notchHeight: Math.max(0, (geometry.notchHeight ?? geometry.top) - lowered),
  };
}

export function stripHeight(fit: NotchFit, quiet: boolean): number {
  return Math.max(fit.strip, quiet ? 0 : MIN_STRIP);
}
