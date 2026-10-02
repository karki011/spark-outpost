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
    title: 'Spark Island',
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
            label: 'Show Spark Island',
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
