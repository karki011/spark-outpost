import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron';
import { ISLAND_HEIGHT, ISLAND_WIDTH, type Point } from './island-geometry.ts';

export const ISLAND_LEVEL = 'status';
export const ISLAND_PATH = '/island';

export function islandWindowOptions(preload: string, at: Point): BrowserWindowConstructorOptions {
  return {
    x: at.x,
    y: at.y,
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    hiddenInMissionControl: true,
    roundedCorners: false,
    type: 'panel',
    title: 'Spark companion',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  };
}

export interface TrayState {
  appName: string;
  companionOn: boolean;
  supported: boolean;
}

export interface TrayActions {
  openSpark: () => void;
  toggleCompanion: (on: boolean) => void;
  quit: () => void;
}

export function trayTemplate(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: `Open ${state.appName}`, click: actions.openSpark },
    ...(state.supported
      ? [
          {
            label: 'Show companion',
            type: 'checkbox' as const,
            checked: state.companionOn,
            click: () => actions.toggleCompanion(!state.companionOn),
          },
        ]
      : []),
    { type: 'separator' },
    { label: `Quit ${state.appName}`, click: actions.quit },
  ];
}

const SAMPLES = 4;

function scoutCovers(x: number, y: number, size: number): boolean {
  const unit = size / 18;
  const bx = (x - 9 * unit) / (7.4 * unit);
  const by = (y - 11.6 * unit) / (6 * unit);
  if (bx * bx + by * by <= 1) return true;
  const ax = 10.6 * unit;
  const ay = 5.6 * unit;
  const tx = 13.4 * unit;
  const ty = 2.6 * unit;
  const length = Math.hypot(tx - ax, ty - ay);
  const along = ((x - ax) * (tx - ax) + (y - ay) * (ty - ay)) / (length * length);
  if (along >= 0 && along <= 1) {
    const px = ax + along * (tx - ax);
    const py = ay + along * (ty - ay);
    if (Math.hypot(x - px, y - py) <= 0.85 * unit) return true;
  }
  return Math.hypot(x - 14.6 * unit, y - 2 * unit) <= 1.6 * unit;
}

export function trayBitmap(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (scoutCovers(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES, size)) hits++;
        }
      }
      pixels[(y * size + x) * 4 + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}
