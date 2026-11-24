import type { DisplayInfo } from './island-geometry.ts';
import { ISLAND_LEVEL } from './island-options.ts';

export function islandSupported(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

export function islandLevel(platform: NodeJS.Platform): 'status' | 'screen-saver' {
  return platform === 'win32' ? 'screen-saver' : ISLAND_LEVEL;
}

export function readsNotches(platform: NodeJS.Platform): boolean {
  return platform !== 'win32';
}

export function windowsDisplay(display: DisplayInfo): DisplayInfo {
  return { ...display, bounds: display.workArea, notch: null };
}
